/**
 * Continuous Health Canada readiness checks: the catalog and the arithmetic. Pure; the queries
 * that find the offending records live in `features/compliance/queries.ts`.
 *
 * The checks encode the record-keeping duties a licence holder must satisfy at all times under the
 * Cannabis Regulations: record retention (s.221-232), inventory and reconciliation (s.244) and
 * the destruction-record duty (s.230). Each check is an exception list, so the console points at
 * the exact records that would fail an inspection rather than a pass/fail bit.
 *
 * Nothing here is English prose: findings and their offenders carry ids and parameters, and the
 * console translates them (`overview.findings.<id>`, `overview.details.<key>`).
 */

export type Severity = "critical" | "warning" | "info";

/** In display order. */
export const FINDING_IDS = [
  "inventory-located",
  "cultivar-attribution",
  "provenance-recorded",
  "destruction-documented",
  "destruction-filed-promptly",
  "transfers-scanned",
  "shipment-licence",
  "shipments-reconciled",
  "harvest-weights",
  "experiment-attribution",
  "quality-holds",
  "open-incidents",
] as const;
export type FindingId = (typeof FINDING_IDS)[number];

export const FINDING_SEVERITY: Record<FindingId, Severity> = {
  "inventory-located": "critical",
  "cultivar-attribution": "warning",
  "provenance-recorded": "warning",
  "destruction-documented": "critical",
  "destruction-filed-promptly": "warning",
  "transfers-scanned": "warning",
  "shipment-licence": "critical",
  "shipments-reconciled": "warning",
  "harvest-weights": "critical",
  "experiment-attribution": "info",
  "quality-holds": "warning",
  "open-incidents": "warning",
};

/** Health Canada expects destruction records to be filed promptly, not batched. */
export const STALE_DESTRUCTION_DAYS = 30;
/** Shipments in transit longer than this have not been reconciled. */
export const STUCK_SHIPMENT_DAYS = 30;
/** How many offending records each finding lists (the count is always the full count). */
export const OFFENDER_LIMIT = 12;

export const OFFENDER_DETAIL_KEYS = [
  "noLocation",
  "noCultivar",
  "noSource",
  "destroyedNoReason",
  "filedLate",
  "movedWithoutScan",
  "movedWithoutScanUnknown",
  "noLicence",
  "inTransitDays",
  "noWeight",
  "noExperiment",
  "hold",
  "incident",
] as const;
export type OffenderDetailKey = (typeof OFFENDER_DETAIL_KEYS)[number];

/** Why a record is listed. `kind`, `panel` and `severity` params are enum values the UI translates. */
export type OffenderDetail = {
  key: OffenderDetailKey;
  params: Record<string, string | number>;
};

export type Offender = {
  id: number;
  /** The record's own name or reference (data, not prose). */
  label: string;
  detail: OffenderDetail;
  href: string;
};

export type ComplianceFinding = {
  id: FindingId;
  severity: Severity;
  count: number;
  passing: boolean;
  /** Records that need attention, capped at OFFENDER_LIMIT. */
  offenders: Offender[];
};

export type ComplianceReport = {
  findings: ComplianceFinding[];
  totalChecks: number;
  passingCount: number;
  criticalCount: number;
  warningCount: number;
  advisoryCount: number;
  checkedAt: Date;
};

export function buildFinding(
  id: FindingId,
  count: number,
  offenders: Offender[]
): ComplianceFinding {
  return {
    id,
    severity: FINDING_SEVERITY[id],
    count,
    passing: count === 0,
    offenders: offenders.slice(0, OFFENDER_LIMIT),
  };
}

/** Counts open findings by severity. A finding is open when its exception list is not empty. */
export function summarizeFindings(
  findings: ComplianceFinding[],
  checkedAt: Date
): ComplianceReport {
  const open = findings.filter((finding) => !finding.passing);
  const openOf = (severity: Severity) => open.filter((f) => f.severity === severity).length;
  return {
    findings,
    totalChecks: findings.length,
    passingCount: findings.length - open.length,
    criticalCount: openOf("critical"),
    warningCount: openOf("warning"),
    advisoryCount: openOf("info"),
    checkedAt,
  };
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Open findings, most urgent first: by severity, then by how many records are affected. */
export function openFindingsByUrgency(report: ComplianceReport): ComplianceFinding[] {
  return report.findings
    .filter((finding) => !finding.passing)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `from` to `to` (to defaults to now); negative when `from` is later. */
export function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}
