import { describe, expect, it } from "vitest";
import { positiveIntParam } from "./list-params";

describe("positiveIntParam", () => {
  it("reads a positive whole number that fits a database id", () => {
    expect(positiveIntParam("42")).toBe(42);
    expect(positiveIntParam("2147483647")).toBe(2_147_483_647);
  });

  it("ignores anything else, including ids too large for the database", () => {
    for (const value of [undefined, "", "0", "-3", "1.5", "abc", "99999999999", "2147483648"]) {
      expect(positiveIntParam(value), String(value)).toBeUndefined();
    }
  });
});
