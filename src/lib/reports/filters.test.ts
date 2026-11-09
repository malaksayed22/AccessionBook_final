import { describe, expect, it } from "vitest";
import {
  applyReportDefaults,
  filtersToQuery,
  isDateKey,
  labToday,
  parseReportFilters,
  previousMonth,
  shiftDay,
} from "./filters";

const TORONTO = "America/Toronto";
const parse = (query: Record<string, string>) => parseReportFilters((key) => query[key]);

describe("isDateKey", () => {
  it("accepts real calendar days only", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-02-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-1")).toBe(false);
    expect(isDateKey("tomorrow")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });
});

describe("parseReportFilters", () => {
  it("parses valid parameters into typed filters", () => {
    const { filters, invalid } = parse({
      year: "2026",
      month: "3",
      from: "2026-03-01",
      to: "2026-03-31",
      experimentId: "12",
      locationId: "4",
      unitType: "PLANT",
      status: "active",
      entityType: "unit",
      action: "destroy",
      licenseId: "  LIC-1  ",
    });
    expect(invalid).toEqual([]);
    expect(filters).toEqual({
      year: 2026,
      month: 3,
      from: "2026-03-01",
      to: "2026-03-31",
      experimentId: 12,
      locationId: 4,
      unitType: "PLANT",
      status: "active",
      entityType: "unit",
      action: "destroy",
      licenseId: "LIC-1",
    });
  });

  it("treats empty values as absent", () => {
    expect(parse({ year: "", from: "  ", unitType: "" })).toEqual({ filters: {}, invalid: [] });
  });

  it("reports what it rejects instead of guessing", () => {
    const { filters, invalid } = parse({
      year: "1999",
      month: "13",
      from: "2026-02-31",
      to: "x",
      asOf: "2026-00-10",
      experimentId: "-3",
      locationId: "1.5",
      unitType: "TREE",
      status: "everything",
      entityType: "organization",
      action: "drop table",
      licenseId: "L".repeat(61),
    });
    expect(filters).toEqual({});
    expect([...invalid].sort()).toEqual(
      [
        "action",
        "asOf",
        "entityType",
        "experimentId",
        "from",
        "licenseId",
        "locationId",
        "month",
        "status",
        "to",
        "unitType",
        "year",
      ].sort()
    );
  });

  it("rejects a range that ends before it starts", () => {
    const { filters, invalid } = parse({ from: "2026-03-10", to: "2026-03-01" });
    expect(invalid).toEqual(["to"]);
    expect(filters.to).toBeUndefined();
  });
});

describe("defaults", () => {
  const now = new Date("2026-03-01T03:30:00Z"); // still 28 February in Toronto

  it("reads today in the laboratory zone, not UTC", () => {
    expect(labToday(now, TORONTO)).toEqual({ year: 2026, month: 2, day: "2026-02-28" });
  });

  it("defaults only what the report offers", () => {
    expect(applyReportDefaults({ filters: ["month", "license"] }, {}, now, TORONTO)).toEqual({
      year: 2026,
      month: 2,
    });
    expect(applyReportDefaults({ filters: ["dateRange"] }, {}, now, TORONTO)).toEqual({
      from: "2026-01-29",
      to: "2026-02-28",
    });
    expect(applyReportDefaults({ filters: ["asOf", "location"] }, {}, now, TORONTO)).toEqual({
      asOf: "2026-02-28",
    });
  });

  it("keeps what the operator chose", () => {
    const result = applyReportDefaults(
      { filters: ["dateRange"] },
      { from: "2025-12-01" },
      now,
      TORONTO
    );
    expect(result).toEqual({ from: "2025-12-01", to: "2026-02-28" });
  });

  it("steps across year ends", () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(previousMonth(2026, 7)).toEqual({ year: 2026, month: 6 });
    expect(shiftDay("2026-01-05", 10)).toBe("2025-12-26");
  });
});

describe("filtersToQuery", () => {
  it("writes the filters that reproduce the screen, skipping empty ones", () => {
    const params = new URLSearchParams(
      filtersToQuery({ year: 2026, month: 3, licenseId: "", unitType: "PLANT" })
    );
    expect(params.get("year")).toBe("2026");
    expect(params.get("month")).toBe("3");
    expect(params.get("unitType")).toBe("PLANT");
    expect(params.has("licenseId")).toBe(false);
  });
});
