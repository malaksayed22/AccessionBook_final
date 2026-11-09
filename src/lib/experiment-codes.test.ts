import { describe, expect, it } from "vitest";
import {
  deriveInitials,
  highestCodeNumber,
  isValidCodePrefix,
  normalizeCodePrefix,
} from "./experiment-codes";

describe("deriveInitials", () => {
  it("uses first and last initial for multi-word names", () => {
    expect(deriveInitials("Amira Hassan")).toBe("AH");
    expect(deriveInitials("Jean Luc Picard")).toBe("JP");
  });

  it("falls back to the first two letters for a single name", () => {
    expect(deriveInitials("Omar")).toBe("OM");
  });

  it("disambiguates numbered accounts so sequences do not collide", () => {
    expect(deriveInitials("dummy1")).not.toBe(deriveInitials("dummy2"));
  });
});

describe("normalizeCodePrefix", () => {
  it("keeps a valid user prefix, upper-cased", () => {
    expect(normalizeCodePrefix("ab", "ignored")).toBe("AB");
  });

  it("derives a prefix when the user has none or an invalid one", () => {
    expect(normalizeCodePrefix(null, "Amira Hassan")).toBe("AH");
    expect(normalizeCodePrefix("1", "Amira Hassan")).toBe("AH");
  });
});

describe("isValidCodePrefix", () => {
  it.each(["AB", "abc", "ABCD"])("accepts %s", (value) => {
    expect(isValidCodePrefix(value)).toBe(true);
  });
  it.each(["A", "ABCDE", "A1", ""])("rejects %j", (value) => {
    expect(isValidCodePrefix(value)).toBe(false);
  });
});

describe("highestCodeNumber", () => {
  it("finds the highest number for exactly this prefix", () => {
    expect(highestCodeNumber("AH", ["AH1", "AH7", "AH3", "AHB9", "XAH99", "AB50"])).toBe(7);
  });

  it("returns 0 when the prefix is unused", () => {
    expect(highestCodeNumber("ZZ", ["AH1"])).toBe(0);
  });
});
