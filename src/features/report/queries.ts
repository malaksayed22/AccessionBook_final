import "server-only";
import type { SessionUser } from "@/lib/auth";
import { getReportMeta } from "@/lib/report-catalog";
import { ctlsFormCsv, reportToCsv, runReport, getReportFilterOptions } from "@/lib/reports";
import type { ReportFilters, ReportResult } from "@/lib/reports/types";
import { assertCanReadCompliance } from "@/server/authz";
import { errors } from "@/server/errors";

/*
 * Regulatory reports are administrator-only: inventory figures and the audit trail must not be
 * pulled without authorisation. The generators live in `lib/reports`; these are the doors to them,
 * used by the report pages and by the CSV/JSON endpoint, so both enforce the same rule.
 */

function knownReport(slug: string) {
  const meta = getReportMeta(slug);
  if (!meta) throw errors.notFound("Report");
  return meta;
}

export async function loadReport(
  user: SessionUser,
  slug: string,
  filters: ReportFilters
): Promise<ReportResult> {
  assertCanReadCompliance(user);
  knownReport(slug);
  return runReport(slug, filters);
}

export async function loadReportCsv(
  user: SessionUser,
  slug: string,
  filters: ReportFilters
): Promise<{ csv: string; filename: string }> {
  const result = await loadReport(user, slug, filters);
  const day = result.meta.generatedAt.slice(0, 10);
  return { csv: reportToCsv(result), filename: `${slug}-${day}.csv` };
}

/**
 * The CTLS monthly report as columns A to JS of Health Canada's reporting form (header row and one
 * data row), named after the licence and month.
 */
export async function loadCtlsFormCsv(
  user: SessionUser,
  filters: ReportFilters
): Promise<{ csv: string; filename: string }> {
  const result = await loadReport(user, "ctls-monthly", filters);
  if (!result.ctls) throw errors.notFound("Report");
  const { year, month } = result.ctls;
  const licence = result.meta.licenseId ?? null;
  const name = [
    licence?.replace(/[^A-Za-z0-9-]/g, ""),
    "ctls",
    year,
    String(month).padStart(2, "0"),
  ]
    .filter(Boolean)
    .join("-");
  return { csv: ctlsFormCsv(result.ctls, licence), filename: `${name}.csv` };
}

/** Experiments and active locations for the filter selects. */
export async function loadReportFilterOptions(user: SessionUser) {
  assertCanReadCompliance(user);
  return getReportFilterOptions();
}
