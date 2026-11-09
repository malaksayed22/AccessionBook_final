import { describe, expect, it } from "vitest";
import { formatAuditChanges, parseAuditChanges } from "./audit-changes";

describe("parseAuditChanges", () => {
  it("reads the structured JSON array", () => {
    expect(parseAuditChanges([{ field: "hold", from: null, to: "HOLD" }])).toEqual([
      { field: "hold", from: null, to: "HOLD" },
    ]);
  });

  it("still reads the legacy JSON-string form", () => {
    expect(parseAuditChanges('[{"field":"stage","from":"VEG","to":"FLOWER"}]')).toEqual([
      { field: "stage", from: "VEG", to: "FLOWER" },
    ]);
  });

  it("coerces non-string values and drops malformed entries", () => {
    expect(parseAuditChanges([{ field: "qty", from: 1, to: 2 }, 7, null, { to: "x" }])).toEqual([
      { field: "qty", from: "1", to: "2" },
    ]);
  });

  it.each([null, undefined, "not json", "{}", 42, {}])("returns [] for %j", (input) => {
    expect(parseAuditChanges(input)).toEqual([]);
  });
});

describe("formatAuditChanges", () => {
  it("joins changes with arrows", () => {
    expect(
      formatAuditChanges([
        { field: "a", from: "1", to: "2" },
        { field: "b", from: null, to: "x" },
      ])
    ).toBe("a: 1 → 2; b: — → x");
  });

  it("uses the placeholder when there is nothing to show", () => {
    expect(formatAuditChanges(null)).toBe("—");
    expect(formatAuditChanges(undefined, "n/a")).toBe("n/a");
  });
});
