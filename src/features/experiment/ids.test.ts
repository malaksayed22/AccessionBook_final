import { describe, expect, it } from "vitest";
import { recordIdParam } from "./ids";

describe("recordIdParam", () => {
  it("accepts positive whole numbers that fit an Int column", () => {
    expect(recordIdParam("7")).toBe(7);
    expect(recordIdParam("2147483647")).toBe(2147483647);
  });

  it("rejects everything else", () => {
    for (const bad of [
      undefined,
      "",
      "0",
      "-1",
      "1.5",
      "1e3",
      "abc",
      "2147483648",
      "99999999999",
      " 7",
    ]) {
      expect(recordIdParam(bad), String(bad)).toBeUndefined();
    }
  });
});
