import { describe, expect, it } from "vitest";
import { dayParam, orderedRange } from "./date-filter";

describe("dayParam", () => {
  it("accepts a real calendar day", () => {
    expect(dayParam("2026-02-28")).toBe("2026-02-28");
    expect(dayParam(" 2028-02-29 ")).toBe("2028-02-29");
  });

  it("rejects impossible days and other text", () => {
    expect(dayParam("2026-02-31")).toBeUndefined();
    expect(dayParam("2027-02-29")).toBeUndefined();
    expect(dayParam("2026-13-01")).toBeUndefined();
    expect(dayParam("26-01-01")).toBeUndefined();
    expect(dayParam("2026-01-01T00:00:00Z")).toBeUndefined();
    expect(dayParam("'; DROP TABLE x; --")).toBeUndefined();
    expect(dayParam("")).toBeUndefined();
    expect(dayParam(undefined)).toBeUndefined();
  });
});

describe("orderedRange", () => {
  it("keeps a valid range and swaps a reversed one", () => {
    expect(orderedRange("2026-01-01", "2026-02-01")).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
    });
    expect(orderedRange("2026-05-05", "2026-05-01")).toEqual({
      from: "2026-05-01",
      to: "2026-05-05",
    });
  });

  it("leaves an open range alone", () => {
    expect(orderedRange("2026-05-05", undefined)).toEqual({ from: "2026-05-05", to: undefined });
    expect(orderedRange(undefined, undefined)).toEqual({ from: undefined, to: undefined });
  });
});
