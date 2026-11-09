import {
  CTLS_LINE_TEXT,
  DISPLAY_LINE_IDS,
  ctlsClass,
  ctlsFormHeaders,
  ctlsFormRow,
  type CtlsFormValues,
} from "./ctls-template";
import type { CtlsSection, ReportResult } from "./types";

/** A spreadsheet treats a cell starting with one of these as a formula (CSV injection). */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
/** A plain negative number is data, not a formula: -5, -0.25. */
const NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/;

/**
 * One CSV cell: formula-neutralised, then quoted per RFC 4180 when it contains a comma, a quote
 * or a line break. Numbers are written as they are (a negative number must stay a number); text
 * that could be read as a formula gets a leading single quote, as OWASP recommends.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_TRIGGER.test(text) && !NEGATIVE_NUMBER.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function reportToCsv(result: ReportResult): string {
  const lines: string[] = [];
  const row = (cells: Array<string | number | null | undefined>) =>
    cells.map(escapeCsvCell).join(",");

  lines.push(escapeCsvCell(result.meta.title));
  if (result.meta.periodLabel) lines.push(row(["Period", result.meta.periodLabel]));
  if (result.meta.licenseId) lines.push(row(["Licence ID", result.meta.licenseId]));
  lines.push(row(["Generated", result.meta.generatedAt]));
  lines.push("");

  if (result.ctls) {
    lines.push(...ctlsWorksheet(result.ctls, row), "");
  }

  for (const section of result.sections) {
    lines.push(escapeCsvCell(section.title));
    lines.push(row(section.columns.map((c) => c.label)));
    for (const record of section.rows) {
      lines.push(row(section.columns.map((c) => record[c.key] ?? "")));
    }
    lines.push("");
  }

  return lines.join("\n");
}

type RowWriter = (cells: Array<string | number | null | undefined>) => string;

/** The form's lines down, the classes across, then the checks and notes, for reading and review. */
function ctlsWorksheet(ctls: CtlsSection, row: RowWriter): string[] {
  const lines: string[] = [];
  const classes = ctls.classes.map((c) => ({ ...c, name: ctlsClass(c.id).name }));
  lines.push(row(["Line", ...classes.map((c) => `${c.name} (${c.measure})`)]));
  const lineIds = DISPLAY_LINE_IDS.filter((line) => classes.some((c) => line in c.lines));
  for (const lineId of lineIds) {
    lines.push(row([CTLS_LINE_TEXT[lineId], ...classes.map((c) => c.lines[lineId] ?? "")]));
  }
  lines.push(row(["Reconciles", ...classes.map((c) => (c.reconciles ? "Yes" : "No"))]));
  lines.push("");
  lines.push(
    row(["Tissue cultures (no class on the form)", "Opening", "Added", "Removed", "Closing"])
  );
  const { opening, added, removed, closing } = ctls.cultures;
  lines.push(row(["Cultures", opening, added, removed, closing]));

  const checks = ctlsChecks(ctls);
  if (checks.length > 0) {
    lines.push("", "Check before filing");
    for (const check of checks) lines.push(row([check]));
  }
  if (ctls.reconciliationNotes?.length) {
    lines.push("", "Notes");
    for (const note of ctls.reconciliationNotes) lines.push(row([note]));
  }
  return lines;
}

/** What to verify before filing, in plain English (the screen shows the same, translated). */
export function ctlsChecks(ctls: CtlsSection): string[] {
  const { issues } = ctls;
  const checks: string[] = [];
  if (issues.licenceIdMissing) checks.push("No licence number: set LAB_LICENSE_ID or enter one.");
  if (issues.recipientUnclassified.length > 0) {
    checks.push(
      `Shipped under "Other" because the recipient has no licence class: ${issues.recipientUnclassified.join(", ")}`
    );
  }
  if (issues.countryMissing.length > 0) {
    checks.push(
      `Counted as Canadian because no country is recorded: ${issues.countryMissing.join(", ")}`
    );
  }
  if (issues.unweighed.length > 0) {
    checks.push(`Harvested with no weight, so in no class: ${issues.unweighed.join(", ")}`);
  }
  if (issues.trimShipped.lines > 0) {
    checks.push(
      `${issues.trimShipped.lines} trim line(s) shipped (${issues.trimShipped.grams} g) are not inventory units and are not in the form.`
    );
  }
  return checks;
}

/**
 * Columns A to JS of Health Canada's reporting form: its header row and one data row, to paste into
 * the official form (packaged inventory, sales and business statistics are entered there).
 */
export function ctlsFormCsv(ctls: CtlsSection, licenceId: string | null): string {
  const values: CtlsFormValues = Object.fromEntries(ctls.classes.map((c) => [c.id, c.lines]));
  const row = ctlsFormRow({ year: ctls.year, month: ctls.month, licenceId }, values);
  return (
    [ctlsFormHeaders(), row]
      .map((cells) => cells.map((cell) => escapeCsvCell(formCell(cell))).join(","))
      .join("\r\n") + "\r\n"
  );
}

/** Numbers as the form accepts them: whole counts, kilograms with at most four decimals. */
function formCell(cell: string | number): string {
  if (typeof cell === "string") return cell;
  return Number.isInteger(cell) ? String(cell) : String(Number(cell.toFixed(4)));
}
