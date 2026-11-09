import type { ReportCategory, ReportId, ReportMeta } from "@/lib/reports/types";

/**
 * The reports the application offers. The catalog holds ids, categories and which filters each
 * report takes; titles and descriptions are translated from `reports.catalog.<id>` in
 * messages/<locale>/reports.json, never stored here.
 */
export const REPORT_CATEGORIES = [
  "regulatory",
  "inventory",
  "compliance",
  "operations",
  "audit",
] as const satisfies readonly ReportCategory[];

export const REPORTS: readonly ReportMeta[] = [
  { id: "ctls-monthly", category: "regulatory", adminOnly: true, filters: ["month", "license"] },
  { id: "destruction-register", category: "regulatory", adminOnly: true, filters: ["dateRange"] },
  {
    id: "inventory-snapshot",
    category: "inventory",
    adminOnly: true,
    filters: ["unitType", "location", "experiment"],
  },
  {
    id: "state-at-date",
    category: "inventory",
    adminOnly: true,
    filters: ["asOf", "unitType", "location", "experiment"],
  },
  { id: "inventory-movement", category: "inventory", adminOnly: true, filters: ["dateRange"] },
  {
    id: "transfer-log",
    category: "compliance",
    adminOnly: true,
    filters: ["dateRange", "location"],
  },
  {
    id: "experiment-summary",
    category: "operations",
    adminOnly: true,
    filters: ["experiment", "status"],
  },
  {
    id: "stage-history",
    category: "operations",
    adminOnly: true,
    filters: ["dateRange", "unitType"],
  },
  { id: "activity-audit", category: "audit", adminOnly: true, filters: ["dateRange", "audit"] },
];

export const REPORT_IDS = REPORTS.map((report) => report.id) as readonly ReportId[];

export function getReportMeta(id: string): ReportMeta | undefined {
  return REPORTS.find((report) => report.id === id);
}

export function getReportsByCategory(category: ReportCategory): ReportMeta[] {
  return REPORTS.filter((report) => report.category === category);
}
