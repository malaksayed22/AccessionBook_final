import { describe, expect, it } from "vitest";
import {
  defaultDateRangeFilters,
  defaultMonthFilters,
  formatLabDateTime,
  monthPeriod,
  parseDateRange,
  periodFilter,
  toDateKey,
} from "./date-range";

const TORONTO = "America/Toronto";
const iso = (d: Date | null) => d?.toISOString();

describe("monthPeriod", () => {
  it("runs from local midnight to local midnight in the lab zone (winter, UTC-5)", () => {
    const p = monthPeriod(2025, 1, TORONTO);
    expect(iso(p.start)).toBe("2025-01-01T05:00:00.000Z");
    expect(iso(p.endExclusive)).toBe("2025-02-01T05:00:00.000Z");
    expect(iso(p.end)).toBe("2025-02-01T04:59:59.999Z");
    expect(p.label).toBe("January 2025");
  });

  it("follows the daylight-saving change inside March: 31 days, 743 hours", () => {
    const p = monthPeriod(2025, 3, TORONTO);
    expect(iso(p.start)).toBe("2025-03-01T05:00:00.000Z"); // EST
    expect(iso(p.endExclusive)).toBe("2025-04-01T04:00:00.000Z"); // EDT
    expect((p.endExclusive.getTime() - p.start.getTime()) / 3_600_000).toBe(743);
  });

  it("makes November 25 hours longer at the fall-back change", () => {
    const p = monthPeriod(2025, 11, TORONTO);
    expect((p.endExclusive.getTime() - p.start.getTime()) / 3_600_000).toBe(30 * 24 + 1);
  });

  it("has no gap or overlap between consecutive months", () => {
    for (let month = 1; month <= 12; month += 1) {
      const current = monthPeriod(2025, month, TORONTO);
      const next = monthPeriod(2025, month + 1, TORONTO);
      expect(iso(current.endExclusive)).toBe(iso(next.start));
    }
  });

  it("rolls December into January of the next year", () => {
    expect(iso(monthPeriod(2025, 12, TORONTO).endExclusive)).toBe(
      iso(monthPeriod(2026, 1, TORONTO).start)
    );
  });

  it("is independent of the server's zone", () => {
    expect(iso(monthPeriod(2025, 6, "UTC").start)).toBe("2025-06-01T00:00:00.000Z");
    expect(iso(monthPeriod(2025, 6, "Asia/Tokyo").start)).toBe("2025-05-31T15:00:00.000Z");
  });
});

describe("parseDateRange", () => {
  it("includes the whole of the 'to' day in the lab zone", () => {
    const p = parseDateRange("2025-03-08", "2025-03-09", TORONTO);
    expect(iso(p.start)).toBe("2025-03-08T05:00:00.000Z");
    // 9 March is the 23-hour spring-forward day: it ends at midnight EDT = 04:00Z on the 10th.
    expect(iso(p.endExclusive)).toBe("2025-03-10T04:00:00.000Z");
    expect(iso(p.end)).toBe("2025-03-10T03:59:59.999Z");
    expect(p.label).toBe("2025-03-08 – 2025-03-09");
  });

  it("uses a single day when from equals to", () => {
    const p = parseDateRange("2025-06-15", "2025-06-15", TORONTO);
    expect((p.endExclusive!.getTime() - p.start!.getTime()) / 3_600_000).toBe(24);
  });

  it("allows open-ended ranges", () => {
    expect(parseDateRange(undefined, undefined, TORONTO)).toMatchObject({
      start: null,
      end: null,
      endExclusive: null,
      label: "All time",
    });
    expect(parseDateRange("2025-01-01", undefined, TORONTO).label).toBe("From 2025-01-01");
    expect(parseDateRange(undefined, "2025-01-31", TORONTO).label).toBe("Until 2025-01-31");
  });

  it("reads a timestamp as the lab-zone day it falls on", () => {
    // 03:30Z on 1 Apr is 23:30 EDT on 31 March in Toronto.
    expect(toDateKey("2025-04-01T03:30:00Z", TORONTO)).toBe("2025-03-31");
  });

  it("rejects impossible dates", () => {
    expect(() => parseDateRange("2025-02-31", undefined, TORONTO)).toThrow("Invalid date");
    expect(() => parseDateRange("not a date", undefined, TORONTO)).toThrow("Invalid date");
  });
});

describe("periodFilter", () => {
  it("builds a half-open [gte, lt) filter", () => {
    const p = parseDateRange("2025-01-01", "2025-01-31", TORONTO);
    expect(periodFilter(p)).toEqual({ gte: p.start, lt: p.endExclusive });
  });

  it("is undefined when unbounded", () => {
    expect(periodFilter(parseDateRange(undefined, undefined, TORONTO))).toBeUndefined();
  });
});

describe("defaults and formatting", () => {
  it("picks the month the lab zone is in, not UTC", () => {
    // 02:00Z on 1 Nov is still 31 October in Toronto.
    const now = new Date("2025-11-01T02:00:00Z");
    expect(defaultMonthFilters(now, TORONTO)).toEqual({ year: 2025, month: 10 });
    expect(defaultMonthFilters(now, "UTC")).toEqual({ year: 2025, month: 11 });
  });

  it("counts the default range back in calendar days", () => {
    const now = new Date("2025-03-10T15:00:00Z");
    expect(defaultDateRangeFilters(30, now, TORONTO)).toEqual({
      from: "2025-02-08",
      to: "2025-03-10",
    });
  });

  it("formats timestamps in the lab zone, 24-hour", () => {
    expect(formatLabDateTime(new Date("2025-07-01T03:30:00Z"), TORONTO)).toBe("2025-06-30 23:30");
    expect(formatLabDateTime(new Date("2025-07-01T04:00:00Z"), TORONTO)).toBe("2025-07-01 00:00");
  });
});
