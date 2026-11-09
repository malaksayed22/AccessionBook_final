import { zonedDateKey } from "@/lib/lab-time";
import type { ReportFilters, ReportMeta } from "./types";

/**
 * Report filters arrive as untrusted URL parameters (on the page and on the CSV/JSON endpoint).
 * Parsing is strict and says which parameters were rejected: a regulatory export must never
 * silently widen to "all time" because a date was mistyped.
 */
export const UNIT_TYPE_VALUES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;
export const REPORT_STATUS_VALUES = ["all", "active", "completed"] as const;
export const AUDIT_ENTITY_VALUES = ["all", "unit", "experiment"] as const;
export const AUDIT_ACTION_VALUES = [
  "all",
  "create",
  "derive",
  "stage_transition",
  "transfer",
  "update",
  "destroy",
] as const;

export type ReportFilterParam = keyof ReportFilters;

export type ParsedReportFilters = {
  filters: ReportFilters;
  /** Parameters that were present but not acceptable. Empty values count as absent. */
  invalid: ReportFilterParam[];
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LICENCE_MAX_LENGTH = 60;

/** True for a real calendar day written `YYYY-MM-DD` (rejects 2026-02-31, which Date would roll over). */
export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function integerInRange(value: string, min: number, max: number): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/** Parses report parameters. `read` returns the raw text of a parameter, or undefined. */
export function parseReportFilters(read: (key: string) => string | undefined): ParsedReportFilters {
  const filters: ReportFilters = {};
  const invalid: ReportFilterParam[] = [];
  const get = (key: ReportFilterParam) => read(key)?.trim() || undefined;

  const take = <K extends ReportFilterParam>(
    key: K,
    parse: (raw: string) => ReportFilters[K] | undefined
  ) => {
    const raw = get(key);
    if (raw === undefined) return;
    const value = parse(raw);
    if (value === undefined) invalid.push(key);
    else filters[key] = value;
  };

  take("year", (raw) => integerInRange(raw, 2000, 2100));
  take("month", (raw) => integerInRange(raw, 1, 12));
  take("from", (raw) => (isDateKey(raw) ? raw : undefined));
  take("to", (raw) => (isDateKey(raw) ? raw : undefined));
  take("asOf", (raw) => (isDateKey(raw) ? raw : undefined));
  take("licenseId", (raw) => (raw.length <= LICENCE_MAX_LENGTH ? raw : undefined));
  take("experimentId", (raw) => integerInRange(raw, 1, 2_147_483_647));
  take("locationId", (raw) => integerInRange(raw, 1, 2_147_483_647));
  take("unitType", (raw) => oneOf(raw, UNIT_TYPE_VALUES));
  take("status", (raw) => oneOf(raw, REPORT_STATUS_VALUES));
  take("entityType", (raw) => oneOf(raw, AUDIT_ENTITY_VALUES));
  take("action", (raw) => oneOf(raw, AUDIT_ACTION_VALUES));

  if (filters.from && filters.to && filters.from > filters.to && !invalid.includes("to")) {
    invalid.push("to");
    delete filters.to;
  }
  return { filters, invalid };
}

export type LabDay = { year: number; month: number; day: string };

/** Today in the laboratory zone: year, month and `YYYY-MM-DD`. */
export function labToday(now: Date, zone: string): LabDay {
  const day = zonedDateKey(now, zone);
  const [year, month] = day.split("-").map(Number) as [number, number];
  return { year, month, day };
}

/** The calendar month before `year`/`month`. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** `days` before a `YYYY-MM-DD` day, as `YYYY-MM-DD`. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Fills in what a report needs when the operator gave nothing: the current laboratory month for
 * monthly reports, the last 30 days for period reports, today for point-in-time reports. Only the
 * filters the report actually offers are defaulted, so the form and the export always agree.
 */
export function applyReportDefaults(
  report: Pick<ReportMeta, "filters">,
  filters: ReportFilters,
  now: Date,
  zone: string,
  rangeDays = 30
): ReportFilters {
  const today = labToday(now, zone);
  const result: ReportFilters = { ...filters };
  if (report.filters.includes("month")) {
    result.year ??= today.year;
    result.month ??= today.month;
  }
  if (report.filters.includes("dateRange")) {
    result.to ??= today.day;
    result.from ??= shiftDay(result.to, rangeDays);
  }
  if (report.filters.includes("asOf")) {
    result.asOf ??= today.day;
  }
  return result;
}

const QUERY_KEYS: ReportFilterParam[] = [
  "year",
  "month",
  "from",
  "to",
  "asOf",
  "licenseId",
  "experimentId",
  "unitType",
  "locationId",
  "entityType",
  "action",
  "status",
];

/** The query string that reproduces `filters` (used for the CSV link, so it matches the screen). */
export function filtersToQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}
