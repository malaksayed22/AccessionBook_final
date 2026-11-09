import type { ReportFilters, ReportResult } from "./types";
import { getReportMeta } from "@/lib/report-catalog";
import { generateCtlsMonthly } from "./ctls-monthly";
import { generateDestructionRegister } from "./destruction-register";
import { generateInventorySnapshot, generateStateAtDate } from "./inventory-snapshot";
import { generateInventoryMovement } from "./inventory-movement";
import { generateTransferLog } from "./transfer-log";
import { generateExperimentSummary } from "./experiment-summary";
import { generateStageHistory } from "./stage-history";
import { generateActivityAudit } from "./activity-audit";

export async function runReport(reportId: string, filters: ReportFilters): Promise<ReportResult> {
  const meta = getReportMeta(reportId);
  if (!meta) throw new Error("UNKNOWN_REPORT");

  switch (reportId) {
    case "ctls-monthly":
      return generateCtlsMonthly(filters);
    case "destruction-register":
      return generateDestructionRegister(filters);
    case "inventory-snapshot":
      return generateInventorySnapshot(filters);
    case "state-at-date":
      return generateStateAtDate(filters);
    case "inventory-movement":
      return generateInventoryMovement(filters);
    case "transfer-log":
      return generateTransferLog(filters);
    case "experiment-summary":
      return generateExperimentSummary(filters);
    case "stage-history":
      return generateStageHistory(filters);
    case "activity-audit":
      return generateActivityAudit(filters);
    default:
      throw new Error("UNKNOWN_REPORT");
  }
}

export { ctlsFormCsv, reportToCsv } from "./csv";
export { getReportFilterOptions } from "./inventory-snapshot";
export type { ReportFilters, ReportResult } from "./types";
