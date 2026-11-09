import { describe, expect, it } from "vitest";
import { hashPassword, passwordNeedsRehash, passwordPolicyError, verifyPassword } from "./password";

describe("password hashing", () => {
  it("uses Argon2id with a fresh salt each time and verifies correctly", async () => {
    const a = await hashPassword("a long enough passphrase");
    const b = await hashPassword("a long enough passphrase");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("a long enough passphrase", a)).toBe(true);
    expect(await verifyPassword("a different passphrase", a)).toBe(false);
    expect(passwordNeedsRehash(a)).toBe(false);
  });

  it("treats empty and malformed stored hashes as a mismatch", async () => {
    expect(await verifyPassword("anything at all", "")).toBe(false);
    expect(await verifyPassword("anything at all", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything at all", "$2a$10$abcdefghijklmnopqrstuv")).toBe(false);
  });

  it("flags hashes made with weaker parameters for upgrade", async () => {
    const weak = (await hashPassword("a long enough passphrase")).replace(
      "m=19456,p=1,t=2",
      "m=8192,p=1,t=1"
    );
    expect(passwordNeedsRehash(weak)).toBe(true);
  });
});

describe("password policy", () => {
  it("requires length, bounds it, and rejects usernames and common choices", () => {
    expect(passwordPolicyError("short")).toMatch(/at least 12/);
    expect(passwordPolicyError("x".repeat(257) + "ab")).toMatch(/at most/);
    expect(passwordPolicyError("my-ada-lovelace-pass", "Ada Lovelace")).toBeNull();
    expect(passwordPolicyError("Ada Lovelace rocks!!", "Ada Lovelace")).toMatch(/username/);
    expect(passwordPolicyError("password1234")).toMatch(/common/);
    expect(passwordPolicyError("PASSWORD1234")).toMatch(/common/);
    expect(passwordPolicyError("aaaaaaaaaaaaaaaa")).toMatch(/common/);
    expect(passwordPolicyError("abababababababab")).toMatch(/repetitive/);
    expect(passwordPolicyError("correct horse battery staple")).toBeNull();
  });
});
