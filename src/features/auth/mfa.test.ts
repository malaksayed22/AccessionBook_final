import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, matchTotp } from "./mfa";

const SECRET = "JBSWY3DPEHPK3PXP";
const at = (ms: number) =>
  new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(SECRET),
  }).generate({
    timestamp: ms,
  });

describe("matchTotp", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);

  it("accepts the current code and one step either side, and reports the step", () => {
    const step = Math.floor(now / 30_000);
    expect(matchTotp(SECRET, at(now), now)).toBe(step);
    expect(matchTotp(SECRET, at(now - 30_000), now)).toBe(step - 1);
    expect(matchTotp(SECRET, at(now + 30_000), now)).toBe(step + 1);
  });

  it("rejects stale, future and malformed input", () => {
    expect(matchTotp(SECRET, at(now - 90_000), now)).toBeNull();
    expect(matchTotp(SECRET, at(now + 90_000), now)).toBeNull();
    expect(matchTotp(SECRET, "12345", now)).toBeNull();
    expect(matchTotp(SECRET, "abcdef", now)).toBeNull();
    expect(matchTotp(SECRET, "", now)).toBeNull();
  });

  it("ignores spaces typed into the code", () => {
    const code = at(now);
    expect(matchTotp(SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
  });
});

describe("generateRecoveryCodes", () => {
  it("makes distinct, readable codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
