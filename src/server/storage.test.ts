import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeKey,
  LocalDiskStorage,
  S3Storage,
  StorageKeyExistsError,
  type S3Sender,
} from "./storage";

const UNSAFE_KEYS = [
  "",
  "../x",
  "a/../../x",
  "a/..",
  "/etc/passwd",
  "a\\b",
  "..\\x",
  "a//b",
  "a/./b",
  "a\0b",
  "a".repeat(513),
];

describe("assertSafeKey", () => {
  it("accepts server-generated keys", () => {
    expect(() => assertSafeKey("units/12/3f2b9c1e-0000-4000-8000-000000000000.pdf")).not.toThrow();
    expect(() => assertSafeKey("a".repeat(512))).not.toThrow();
  });

  it.each(UNSAFE_KEYS)("rejects %j", (key) => {
    expect(() => assertSafeKey(key)).toThrow("Invalid storage key");
  });
});

describe("LocalDiskStorage", () => {
  let root: string;
  let disk: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "storage-test-"));
    disk = new LocalDiskStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes", async () => {
    const data = Buffer.from([0, 1, 2, 255]);
    await disk.put("units/1/a.bin", data);
    expect(await disk.get("units/1/a.bin")).toEqual(data);
  });

  it("returns null for a missing key", async () => {
    expect(await disk.get("units/1/missing.bin")).toBeNull();
  });

  it("never overwrites an existing key", async () => {
    await disk.put("units/1/a.bin", Buffer.from("first"));
    await expect(disk.put("units/1/a.bin", Buffer.from("second"))).rejects.toBeInstanceOf(
      StorageKeyExistsError
    );
    expect(await disk.get("units/1/a.bin")).toEqual(Buffer.from("first"));
  });

  it.each(UNSAFE_KEYS)("refuses key %j for put and get", async (key) => {
    await expect(disk.put(key, Buffer.from("x"))).rejects.toThrow("Invalid storage key");
    await expect(disk.get(key)).rejects.toThrow("Invalid storage key");
  });

  it("refuses an absolute path to a location outside the root", async () => {
    const outside = path.join(tmpdir(), "outside.bin");
    await expect(disk.put(outside, Buffer.from("x"))).rejects.toThrow("Invalid storage key");
  });
});

type SentCommand = PutObjectCommand | GetObjectCommand;

function fakeClient(respond: (command: SentCommand) => unknown) {
  const sent: SentCommand[] = [];
  const client: S3Sender = {
    send: async (command) => {
      sent.push(command as SentCommand);
      return respond(command as SentCommand);
    },
  };
  return { client, sent };
}

function s3Error(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

describe("S3Storage", () => {
  const data = Buffer.from("evidence");

  it("puts write-once with SSE-S3 and a SHA-256 checksum when no KMS key is set", async () => {
    const { client, sent } = fakeClient(() => ({}));
    await new S3Storage({ client, bucket: "bucket" }).put("units/1/a.pdf", data);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect((sent[0] as PutObjectCommand).input).toEqual({
      Bucket: "bucket",
      Key: "units/1/a.pdf",
      Body: data,
      ChecksumAlgorithm: "SHA256",
      IfNoneMatch: "*",
      ServerSideEncryption: "AES256",
    });
  });

  it("puts with SSE-KMS when a key is configured", async () => {
    const { client, sent } = fakeClient(() => ({}));
    await new S3Storage({ client, bucket: "bucket", kmsKeyId: "alias/evidence" }).put(
      "units/1/a.pdf",
      data
    );

    expect((sent[0] as PutObjectCommand).input).toMatchObject({
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "alias/evidence",
      IfNoneMatch: "*",
      ChecksumAlgorithm: "SHA256",
    });
  });

  it("maps PreconditionFailed to a write-once error", async () => {
    const { client } = fakeClient(() => {
      throw s3Error("PreconditionFailed", 412);
    });
    await expect(
      new S3Storage({ client, bucket: "bucket" }).put("units/1/a.pdf", data)
    ).rejects.toBeInstanceOf(StorageKeyExistsError);
  });

  it("maps a bare 412 status to a write-once error", async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error("x"), { $metadata: { httpStatusCode: 412 } });
    });
    await expect(
      new S3Storage({ client, bucket: "bucket" }).put("units/1/a.pdf", data)
    ).rejects.toBeInstanceOf(StorageKeyExistsError);
  });

  it("rethrows other put errors", async () => {
    const failure = s3Error("AccessDenied", 403);
    const { client } = fakeClient(() => {
      throw failure;
    });
    await expect(
      new S3Storage({ client, bucket: "bucket" }).put("units/1/a.pdf", data)
    ).rejects.toBe(failure);
  });

  it("gets with the right command and reads a streamed body into a Buffer", async () => {
    const { client, sent } = fakeClient(() => ({
      Body: Readable.from([Buffer.from("evi"), Buffer.from("dence")]),
    }));
    const result = await new S3Storage({ client, bucket: "bucket" }).get("units/1/a.pdf");

    expect(result).toEqual(data);
    expect(sent[0]).toBeInstanceOf(GetObjectCommand);
    expect((sent[0] as GetObjectCommand).input).toEqual({ Bucket: "bucket", Key: "units/1/a.pdf" });
  });

  it("returns null for NoSuchKey and for a bare 404", async () => {
    for (const failure of [
      s3Error("NoSuchKey", 404),
      Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } }),
    ]) {
      const { client } = fakeClient(() => {
        throw failure;
      });
      expect(await new S3Storage({ client, bucket: "bucket" }).get("units/1/a.pdf")).toBeNull();
    }
  });

  it("rethrows other get errors", async () => {
    const failure = s3Error("InternalError", 500);
    const { client } = fakeClient(() => {
      throw failure;
    });
    await expect(new S3Storage({ client, bucket: "bucket" }).get("units/1/a.pdf")).rejects.toBe(
      failure
    );
  });

  it("fails on a response without a readable body", async () => {
    const { client } = fakeClient(() => ({}));
    await expect(new S3Storage({ client, bucket: "bucket" }).get("units/1/a.pdf")).rejects.toThrow(
      "Unexpected S3 response body"
    );
  });

  it.each(UNSAFE_KEYS)("refuses key %j without calling S3", async (key) => {
    const { client, sent } = fakeClient(() => ({}));
    const s3 = new S3Storage({ client, bucket: "bucket" });
    await expect(s3.put(key, data)).rejects.toThrow("Invalid storage key");
    await expect(s3.get(key)).rejects.toThrow("Invalid storage key");
    expect(sent).toHaveLength(0);
  });
});
