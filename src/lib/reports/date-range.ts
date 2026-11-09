import { startOfNextZonedDay, startOfZonedDay, zonedDateKey } from "@/lib/lab-time";
import { env } from "@/server/env";

/**
 * Report periods are calendar days and months in the laboratory time zone, never the server's.
 * Every function takes the zone explicitly (defaulting to `LAB_TIMEZONE`) so it can be tested
 * without an environment.
 */
export type ReportPeriod = {
  start: Date;
  /** Last millisecond of the period (inclusive); kept for callers that compare with `<=`. */
  end: Date;
  /** First instant after the period: use `lt` with this when querying. */
  endExclusive: Date;
  label: string;
};

export type OpenReportPeriod = {
  start: Date | null;
  end: Date | null;
  endExclusive: Date | null;
  label: string;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function labZone(): string {
  return env().LAB_TIMEZONE;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-01` for a (possibly overflowing) month number: month 13 of 2026 is January 2027. */
function monthKey(year: number, month: number): string {
  const anchor = new Date(Date.UTC(year, month - 1, 1));
  return `${anchor.getUTCFullYear()}-${pad(anchor.getUTCMonth() + 1)}-01`;
}

/** Normalises an operator-entered `YYYY-MM-DD` (or a full timestamp) to a lab-zone date key. */
export function toDateKey(value: string, zone: string): string {
  const trimmed = value.trim();
  if (DATE_KEY.test(trimmed)) {
    // Rejects 2026-02-31 and the like, which Date.UTC would silently roll over.
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
      throw new Error(`Invalid date: ${value}`);
    }
    return trimmed;
  }
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid date: ${value}`);
  return zonedDateKey(instant, zone);
}

/** The calendar month `month` (1-12) of `year` in the lab zone. */
export function monthPeriod(year: number, month: number, zone: string = labZone()): ReportPeriod {
  const firstDay = monthKey(year, month);
  const nextFirstDay = monthKey(year, month + 1);
  const start = startOfZonedDay(firstDay, zone);
  const endExclusive = startOfZonedDay(nextFirstDay, zone);
  const label = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    month: "long",
    year: "numeric",
  }).format(new Date(start.getTime() + 12 * 3_600_000));
  return { start, end: new Date(endExclusive.getTime() - 1), endExclusive, label };
}

/**
 * `from`..`to` as whole lab-zone days: `from` starts at midnight, `to` runs through the last
 * millisecond of that day. Either bound may be omitted.
 */
export function parseDateRange(
  from?: string,
  to?: string,
  zone: string = labZone()
): OpenReportPeriod {
  const fromKey = from ? toDateKey(from, zone) : null;
  const toKey = to ? toDateKey(to, zone) : null;
  const start = fromKey ? startOfZonedDay(fromKey, zone) : null;
  const endExclusive = toKey ? startOfNextZonedDay(toKey, zone) : null;
  const end = endExclusive ? new Date(endExclusive.getTime() - 1) : null;
  const label =
    fromKey && toKey
      ? `${fromKey} – ${toKey}`
      : fromKey
        ? `From ${fromKey}`
        : toKey
          ? `Until ${toKey}`
          : "All time";
  return { start, end, endExclusive, label };
}

/** Prisma `DateTimeFilter` for a period: `[start, endExclusive)`, or undefined when unbounded. */
export function periodFilter(period: {
  start: Date | null;
  endExclusive: Date | null;
}): { gte?: Date; lt?: Date } | undefined {
  if (!period.start && !period.endExclusive) return undefined;
  return {
    ...(period.start ? { gte: period.start } : {}),
    ...(period.endExclusive ? { lt: period.endExclusive } : {}),
  };
}

export function defaultMonthFilters(
  now: Date = new Date(),
  zone: string = labZone()
): { year: number; month: number } {
  const [year, month] = zonedDateKey(now, zone).split("-").map(Number) as [number, number];
  return { year, month };
}

export function defaultDateRangeFilters(
  days = 30,
  now: Date = new Date(),
  zone: string = labZone()
): { from: string; to: string } {
  const to = zonedDateKey(now, zone);
  const [y, m, d] = to.split("-").map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  return { from, to };
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD HH:mm` in the lab zone (24-hour, sortable). */
export function formatLabDateTime(at: Date, zone: string = labZone()): string {
  let format = dateTimeFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    dateTimeFormats.set(zone, format);
  }
  const part = (type: string) => format.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** `YYYY-MM-DD` of the instant in the lab zone. */
export function formatLabDate(at: Date, zone: string = labZone()): string {
  return zonedDateKey(at, zone);
}
