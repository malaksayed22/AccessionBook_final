import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./crypto";

describe("crypto helpers", () => {
  it("round-trips a secret and never repeats a ciphertext", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP");
    const b = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(a)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("detects tampering and unknown formats", () => {
    const parts = encryptSecret("secret").split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0] = body[0]! ^ 1;
    parts[3] = body.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
    expect(() => decryptSecret("garbage")).toThrow();
  });

  it("produces 256-bit URL-safe tokens and stable hashes", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(randomToken());
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
