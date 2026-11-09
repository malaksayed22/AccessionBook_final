import type { Formats } from "next-intl";

/**
 * Named number and date formats, shared by every page (through the request config) and by server code
 * that writes text outside a page, such as the PDF records. `format.number(w, "grams")`.
 */
export const FORMATS = {
  number: {
    /** Regulated weights: grams to the milligram. `format.number(w, "grams")` */
    grams: { style: "unit", unit: "gram", maximumFractionDigits: 3 },
    /** Unit counts: whole numbers. */
    count: { maximumFractionDigits: 0 },
    percent: { style: "percent", maximumFractionDigits: 1 },
  },
  dateTime: {
    date: { year: "numeric", month: "short", day: "numeric" },
    /** Calendar day of the laboratory (ISO-like in both languages for regulatory exports). */
    isoDate: { year: "numeric", month: "2-digit", day: "2-digit" },
    time: { hour: "2-digit", minute: "2-digit" },
    dateTime: {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    },
  },
} satisfies Formats;
