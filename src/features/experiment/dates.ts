/**
 * Experiment dates are calendar days. They are stored as midnight UTC of the day the person picked
 * (the wizard sends "2026-03-04"), so they must be formatted in UTC: formatting them in the
 * laboratory's zone would show the previous evening. Timestamps (when something was recorded) keep
 * the laboratory zone and use the shared `dateTime` format instead.
 */
export const CALENDAR_DAY_FORMAT = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
} as const;

/** `YYYY-MM-DD` for an `<input type="date">`, from a stored calendar day. */
export function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export type ExperimentStatus = "active" | "completed";

/** Running until completed; the end date is the day it was completed. */
export function experimentStatusOf(endDate: Date | null): ExperimentStatus {
  return endDate ? "completed" : "active";
}
