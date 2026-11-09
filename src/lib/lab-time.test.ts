import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  resolveEffectiveAt,
  startOfNextZonedDay,
  startOfZonedDay,
  zoneOffsetMinutes,
  zonedDateKey,
} from "./lab-time";

const TORONTO = "America/Toronto";

describe("zoneOffsetMinutes", () => {
  it("is -300 in winter and -240 in summer for Toronto", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), TORONTO)).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), TORONTO)).toBe(-240);
  });

  it("is zero for UTC", () => {
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "UTC")).toBe(0);
  });
});

describe("zonedDateKey", () => {
  it("assigns a late-evening UTC instant to the previous day in Toronto", () => {
    expect(zonedDateKey(new Date("2026-03-01T03:30:00Z"), TORONTO)).toBe("2026-02-28");
    expect(zonedDateKey(new Date("2026-03-01T03:30:00Z"), "UTC")).toBe("2026-03-01");
  });
});

describe("startOfZonedDay", () => {
  it("returns local midnight as a UTC instant", () => {
    expect(startOfZonedDay("2026-01-15", TORONTO).toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(startOfZonedDay("2026-07-15", TORONTO).toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("handles the spring-forward and fall-back days", () => {
    // 2026-03-08: clocks jump at 02:00 local; midnight is still EST (UTC-5).
    expect(startOfZonedDay("2026-03-08", TORONTO).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    // The next midnight is EDT (UTC-4): the day was only 23 hours long.
    expect(startOfZonedDay("2026-03-09", TORONTO).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    // 2026-11-01: clocks fall back at 02:00; midnight is EDT, the next midnight is EST.
    expect(startOfZonedDay("2026-11-01", TORONTO).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfZonedDay("2026-11-02", TORONTO).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("rejects malformed input", () => {
    expect(() => startOfZonedDay("2026-1-5", TORONTO)).toThrow();
  });
});

describe("startOfNextZonedDay", () => {
  it("gives the exclusive end of a day, including month and DST boundaries", () => {
    expect(startOfNextZonedDay("2026-01-31", TORONTO).toISOString()).toBe(
      "2026-02-01T05:00:00.000Z"
    );
    expect(startOfNextZonedDay("2026-03-08", TORONTO).toISOString()).toBe(
      "2026-03-09T04:00:00.000Z"
    );
    expect(startOfNextZonedDay("2026-12-31", TORONTO).toISOString()).toBe(
      "2027-01-01T05:00:00.000Z"
    );
  });
});

describe("resolveEffectiveAt", () => {
  const now = new Date("2026-10-24T20:15:00Z"); // 16:15 in Toronto

  it("treats today's date-only value as now, so same-day events sort after earlier ones", () => {
    expect(resolveEffectiveAt("2026-10-24", now, TORONTO)).toEqual(now);
  });

  it("treats an earlier date-only value as the start of that day in the lab zone", () => {
    expect(resolveEffectiveAt("2026-10-20", now, TORONTO)?.toISOString()).toBe(
      "2026-10-20T04:00:00.000Z"
    );
  });

  it("uses a full timestamp as given", () => {
    expect(resolveEffectiveAt("2026-10-20T09:30:00Z", now, TORONTO)?.toISOString()).toBe(
      "2026-10-20T09:30:00.000Z"
    );
  });

  it.each([undefined, null, "", "   ", "not a date", 42])("returns null for %j", (input) => {
    expect(resolveEffectiveAt(input, now, TORONTO)).toBeNull();
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects nonsense", () => {
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
