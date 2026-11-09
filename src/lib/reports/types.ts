import type { CtlsLineId, CtlsMeasure, TrackedClassId } from "./ctls-template";

export type ReportCategory = "regulatory" | "inventory" | "compliance" | "operations" | "audit";

export type ReportFormat = "json" | "csv";

/** Every report the application can generate. The catalog, the messages and `runReport` agree on it. */
export type ReportId =
  | "ctls-monthly"
  | "destruction-register"
  | "inventory-snapshot"
  | "state-at-date"
  | "inventory-movement"
  | "transfer-log"
  | "experiment-summary"
  | "stage-history"
  | "activity-audit";

export type ReportFilters = {
  year?: number;
  month?: number;
  from?: string;
  to?: string;
  licenseId?: string;
  experimentId?: number;
  unitType?: string;
  locationId?: number;
  entityType?: string;
  action?: string;
  status?: "active" | "completed" | "all";
  /** `YYYY-MM-DD` in the laboratory time zone: the state-at-date report reads the end of that day. */
  asOf?: string;
};

/** Which filter controls a report offers. Labels live in messages/<locale>/reports.json. */
export type ReportFilterKey =
  | "month"
  | "dateRange"
  | "license"
  | "experiment"
  | "unitType"
  | "location"
  | "audit"
  | "status"
  | "asOf";

/**
 * Catalog entry. Deliberately has no title or description: the catalog returns ids and the UI
 * translates them (`reports.catalog.<id>`). A generated report keeps its own English title and
 * column labels in `ReportResult` because exports are stable regulatory documents.
 */
export type ReportMeta = {
  id: ReportId;
  category: ReportCategory;
  adminOnly?: boolean;
  filters: ReportFilterKey[];
};

export type ReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
};

export type ReportSection = {
  /** Stable identifier the on-screen display translates; exports use `title` and column labels. */
  id?: string;
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  summary?: Record<string, string | number | null>;
};

/** One class of the CTLS unpackaged-inventory section, in the form's unit (count or kilograms). */
export type CtlsFormClass = {
  id: TrackedClassId;
  measure: CtlsMeasure;
  /** Every line of the class, opening and closing included. Lines the class does not have are absent. */
  lines: Partial<Record<CtlsLineId, number>>;
  /** Closing = opening + additions - reductions. */
  reconciles: boolean;
};

/** Things to look at before filing; each names the records concerned. */
export type CtlsIssues = {
  /** No licence number was given and LAB_LICENSE_ID is not set. */
  licenceIdMissing: boolean;
  /** Counterparties with no country, counted as Canadian. */
  countryMissing: string[];
  /** Canadian recipients with no licence class the form has a shipped line for (booked as "Other"). */
  recipientUnclassified: string[];
  /** Harvested units with no weight at the month's end. */
  unweighed: string[];
  /** Outbound trim lines (not units, so not in inventory): how many and their weight in grams. */
  trimShipped: { lines: number; grams: number };
};

export type CtlsSection = {
  year: number;
  month: number;
  classes: CtlsFormClass[];
  /** True when every class reconciles. */
  reconciles: boolean;
  /** Tissue cultures have no class on the form: counted apart. */
  cultures: { opening: number; added: number; removed: number; closing: number };
  issues: CtlsIssues;
  reconciliationNotes?: string[];
};

export type ReportResult = {
  meta: {
    reportId: string;
    title: string;
    generatedAt: string;
    periodLabel?: string;
    licenseId?: string;
    subtitle?: string;
  };
  sections: ReportSection[];
  ctls?: CtlsSection;
  kpis?: Array<{ id?: string; label: string; value: string | number }>;
};
