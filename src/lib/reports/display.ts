import {
  CTLS_LINE_TEXT,
  DISPLAY_LINE_IDS,
  TRACKED_CLASS_IDS,
  ctlsClass,
  type DisplayLineId,
  type TrackedClassId,
} from "./ctls-template";

/**
 * On-screen vocabulary of generated reports.
 *
 * A generated report (`ReportResult`) carries English titles, column labels and a few English
 * words in its cells, because the CSV and JSON exports are stable regulatory documents: their
 * column names must not change with the reader's language. The screen translates the same report
 * by looking up the stable ids below in messages/<locale>/reports.json (`display.*`). Anything not
 * listed here falls back to the generator's own English text, so a new column is never blank.
 */

export const SECTION_IDS = [
  "form-movements",
  "destruction-detail",
  "additions-detail",
  "destruction-records",
  "by-type",
  "by-stage",
  "by-location",
  "by-cultivar",
  "unit-detail",
  "movement-ledger",
  "event-summary",
  "transfer-records",
  "experiment-overview",
  "stage-transitions",
  "audit-log",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTIONS_WITH_DESCRIPTION = [
  "form-movements",
  "additions-detail",
  "destruction-records",
] as const;
export type SectionWithDescription = (typeof SECTIONS_WITH_DESCRIPTION)[number];

export const KPI_IDS = [
  "activeAtClose",
  "newUnits",
  "destructions",
  "shipments",
  "derivations",
  "externalReceipts",
  "reconciled",
  "totalDestructions",
  "plantsDestroyed",
  "culturesDestroyed",
  "activeUnits",
  "locations",
  "cultivars",
  "experiments",
  "totalEvents",
  "additions",
  "reductions",
  "stageChanges",
  "totalTransfers",
  "barcodeConfirmed",
  "unconfirmedScans",
  "totalUnits",
  "activeExperiments",
  "transitions",
  "unitsAffected",
  "toFlowering",
  "totalEntries",
  "uniqueUsers",
  "unitEvents",
] as const;
export type KpiId = (typeof KPI_IDS)[number];

export const COLUMN_KEYS = [
  "date",
  "dateTime",
  "destructionDate",
  "unit",
  "type",
  "materialType",
  "cultivar",
  "experiment",
  "notes",
  "comment",
  "source",
  "location",
  "lastLocation",
  "stage",
  "stageState",
  "lastStage",
  "weight",
  "reason",
  "witness",
  "recordedBy",
  "filedAt",
  "count",
  "wet",
  "dry",
  "seeds",
  "quantity",
  "direction",
  "action",
  "detail",
  "user",
  "role",
  "entity",
  "summary",
  "changes",
  "fromLocation",
  "toLocation",
  "fromStage",
  "toStage",
  "confirmed",
  "operator",
  "ecode",
  "name",
  "status",
  "start",
  "end",
  "totalUnits",
  "active",
  "destroyed",
  "shipped",
  "plants",
  "cultures",
  "seedLots",
  "flowers",
  "team",
  "subExperiments",
  "events",
  "class",
  "line",
  "measure",
  "counterparty",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** Columns whose generator key is shared by several sections with different meanings. */
const COLUMN_BY_SECTION: Record<string, ColumnKey> = {
  "destruction-records.date": "destructionDate",
  "destruction-records.type": "materialType",
  "destruction-records.location": "lastLocation",
  "destruction-records.stage": "lastStage",
  "transfer-records.date": "dateTime",
  "transfer-records.comment": "notes",
  "transfer-records.from": "fromLocation",
  "transfer-records.to": "toLocation",
  "stage-transitions.date": "dateTime",
  "stage-transitions.from": "fromStage",
  "stage-transitions.to": "toStage",
  "audit-log.date": "dateTime",
  "destruction-detail.comment": "notes",
  "unit-detail.name": "unit",
  "unit-detail.stage": "stageState",
  "event-summary.count": "events",
};

function isColumnKey(value: string): value is ColumnKey {
  return (COLUMN_KEYS as readonly string[]).includes(value);
}

/** The translation key for a column, or null when the display should use the generator's label. */
export function resolveColumnKey(sectionId: string | undefined, key: string): ColumnKey | null {
  const scoped = sectionId ? COLUMN_BY_SECTION[`${sectionId}.${key}`] : undefined;
  if (scoped) return scoped;
  return isColumnKey(key) ? key : null;
}

export function isSectionId(value: string | undefined): value is SectionId {
  return value !== undefined && (SECTION_IDS as readonly string[]).includes(value);
}

export function isSectionWithDescription(
  value: string | undefined
): value is SectionWithDescription {
  return value !== undefined && (SECTIONS_WITH_DESCRIPTION as readonly string[]).includes(value);
}

export function isKpiId(value: string | undefined): value is KpiId {
  return value !== undefined && (KPI_IDS as readonly string[]).includes(value);
}

// --- Cell values -----------------------------------------------------------------------------

const UNIT_TYPES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;
const GROWTH_STAGES = [
  "VEGETATIVE",
  "FLOWERING",
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
  "SEED",
  "CULTURE",
] as const;
const SOURCE_TYPES = [
  "SEED",
  "CUTTING",
  "CLONE",
  "SUBCULTURE",
  "RECEIVED",
  "INTERNAL",
  "HARVEST",
  "OTHER",
] as const;

/** English words the generators write into cells; the screen shows them in the reader's language. */
const TOKENS = {
  Addition: "addition",
  Reduction: "reduction",
  Change: "change",
  Registered: "registered",
  Derived: "derived",
  Received: "received",
  Shipped: "shipped",
  Destroyed: "destroyed",
  Moved: "moved",
  "Stage transition": "stageTransition",
  Measured: "measured",
  Yes: "yes",
  No: "no",
  Ongoing: "ongoing",
  Unassigned: "unassigned",
  Unknown: "unknown",
  "No stage": "noStage",
} as const;
export type TokenKey = (typeof TOKENS)[keyof typeof TOKENS];

export type CellTranslation =
  | { ns: "ctlsClass"; key: TrackedClassId }
  | { ns: "ctlsLine"; key: DisplayLineId }
  | { ns: "unitType"; key: (typeof UNIT_TYPES)[number] }
  | { ns: "growthStage"; key: (typeof GROWTH_STAGES)[number] }
  | { ns: "sourceType"; key: (typeof SOURCE_TYPES)[number] }
  | { ns: "experimentStatus"; key: "active" | "completed" }
  | { ns: "token"; key: TokenKey };

type CellKind =
  | "ctlsClass"
  | "ctlsLine"
  | "unitType"
  | "growthStage"
  | "sourceType"
  | "experimentStatus"
  | "token";

/** Which cells hold a translatable value. Everything else (names, codes, dates) is shown as is. */
const CELL_KINDS: Record<string, CellKind> = {
  "form-movements.class": "ctlsClass",
  "form-movements.line": "ctlsLine",
  "destruction-detail.type": "unitType",
  "additions-detail.type": "unitType",
  "additions-detail.source": "sourceType",
  "destruction-records.type": "unitType",
  "destruction-records.stage": "growthStage",
  "by-type.type": "unitType",
  "by-stage.stage": "growthStage",
  "by-location.location": "token",
  "by-cultivar.cultivar": "token",
  "unit-detail.type": "unitType",
  "unit-detail.stage": "growthStage",
  "movement-ledger.type": "unitType",
  "movement-ledger.direction": "token",
  "movement-ledger.action": "token",
  "event-summary.direction": "token",
  "event-summary.action": "token",
  "transfer-records.type": "unitType",
  "transfer-records.confirmed": "token",
  "stage-transitions.type": "unitType",
  "stage-transitions.from": "growthStage",
  "stage-transitions.to": "growthStage",
  "experiment-overview.status": "experimentStatus",
  "experiment-overview.end": "token",
};

function member<T extends string>(list: readonly T[], value: string): T | undefined {
  return list.find((candidate) => candidate === value);
}

function tokenOf(value: string): TokenKey | undefined {
  return (TOKENS as Record<string, TokenKey>)[value];
}

/**
 * How to translate one cell, or null to show it unchanged. Matching is on the whole value and
 * only in columns known to hold vocabulary, so a unit that happens to be named "Moved" is safe.
 */
export function translateCell(
  sectionId: string | undefined,
  columnKey: string,
  value: string | number | null
): CellTranslation | null {
  if (typeof value !== "string" || !sectionId) return null;
  const kind = CELL_KINDS[`${sectionId}.${columnKey}`];
  if (!kind) return null;

  if (kind === "ctlsClass") {
    const key = TRACKED_CLASS_IDS.find((id) => ctlsClass(id).name === value);
    return key ? { ns: "ctlsClass", key } : null;
  }
  if (kind === "ctlsLine") {
    const key = DISPLAY_LINE_IDS.find((id) => CTLS_LINE_TEXT[id] === value);
    return key ? { ns: "ctlsLine", key } : null;
  }

  if (kind === "unitType") {
    const key = member(UNIT_TYPES, value);
    return key ? { ns: "unitType", key } : null;
  }
  if (kind === "growthStage") {
    const key = member(GROWTH_STAGES, value);
    if (key) return { ns: "growthStage", key };
    const token = tokenOf(value);
    return token ? { ns: "token", key: token } : null;
  }
  if (kind === "sourceType") {
    const key = member(SOURCE_TYPES, value);
    return key ? { ns: "sourceType", key } : null;
  }
  if (kind === "experimentStatus") {
    const key = member(["active", "completed"] as const, value);
    return key ? { ns: "experimentStatus", key } : null;
  }
  const token = tokenOf(value);
  return token ? { ns: "token", key: token } : null;
}
