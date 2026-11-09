/**
 * Calendar logic in the laboratory's time zone. Regulatory periods (a CTLS month, a destruction
 * date) are days in the lab's zone, not in whatever zone the server happens to run in.
 * Pure functions: the zone is always passed in.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `zone` from UTC at the given instant, in minutes (Toronto in winter: -300). */
export function zoneOffsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** `YYYY-MM-DD` of the instant as seen in `zone`. */
export function zonedDateKey(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The instant a calendar day begins in `zone` (handles daylight-saving transitions). */
export function startOfZonedDay(dateKey: string, zone: string): Date {
  const match = DATE_ONLY.exec(dateKey);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${dateKey}`);
  const [, y, m, d] = match;
  const wallClockAsUtc = Date.UTC(Number(y), Number(m) - 1, Number(d));
  // The offset can differ between the guess and the true instant around a DST change; settle it.
  let instant = wallClockAsUtc - zoneOffsetMinutes(new Date(wallClockAsUtc), zone) * 60_000;
  instant = wallClockAsUtc - zoneOffsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant);
}

/** First instant of the *next* calendar day: the exclusive end of a day-based period. */
export function startOfNextZonedDay(dateKey: string, zone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return startOfZonedDay(next.toISOString().slice(0, 10), zone);
}

/**
 * Resolves an operator-entered effective date.
 *  - `YYYY-MM-DD` for today resolves to `now`, so a same-day event still sorts after the ones
 *    already filed today; an earlier day resolves to the start of that day in the lab zone.
 *  - A full ISO timestamp is used as given.
 * Returns null when the input is empty or unparseable.
 */
export function resolveEffectiveAt(input: unknown, now: Date, zone: string): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== "string" || !input.trim()) return null;
  const raw = input.trim();
  if (DATE_ONLY.test(raw)) {
    if (raw === zonedDateKey(now, zone)) return now;
    return startOfZonedDay(raw, zone);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
