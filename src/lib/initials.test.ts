import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("uses the first and last word, or the first letter of a single name", () => {
    expect(initialsOf("Amira Hassan")).toBe("AH");
    expect(initialsOf("Jean-Luc de la Fontaine")).toBe("JF");
    expect(initialsOf("admin")).toBe("A");
    expect(initialsOf("  éloïse  ")).toBe("É");
  });

  it("never returns an empty avatar", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
