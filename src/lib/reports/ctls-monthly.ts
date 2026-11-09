import type {
  GrowthStage,
  LicenceClass,
  SourceType,
  UnitStateKind,
  UnitType,
} from "@/generated/prisma/enums";
import { UnitStateKind as Kind } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import {
  buildCtlsLedger,
  tenthGramsToKg,
  type LedgerState,
  type LedgerUnit,
  type Movement,
} from "./ctls-ledger";
import {
  CTLS_LINE_TEXT,
  TRACKED_CLASS_IDS,
  VALUE_LINES,
  ctlsClass,
  type CtlsLineId,
  type TrackedClassId,
} from "./ctls-template";
import { formatLabDate, labZone, monthPeriod } from "./date-range";
import { getInventoryEvents } from "./events";
import { governingStates } from "./state-at-date";
import type { CtlsFormClass, ReportFilters, ReportResult } from "./types";
import { getLabSettings } from "@/server/settings";

type LedgerRow = {
  stateId: number;
  unitId: number;
  unitName: string;
  unitType: UnitType;
  sourceType: SourceType | null;
  hasParent: boolean;
  isSample: boolean;
  kind: UnitStateKind;
  growthStage: GrowthStage | null;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  plantCount: number | null;
  effectiveAt: Date;
  orgName: string | null;
  orgCountry: string | null;
  orgLicenceClass: LicenceClass | null;
};

/** Each unit's governing state at `asOf` (terminal ones included), with what the ledger needs. */
function governingRows(asOf: Date): Promise<LedgerRow[]> {
  return prisma.$queryRaw<LedgerRow[]>`
    SELECT g."id" AS "stateId",
           g."unitId" AS "unitId",
           u."name" AS "unitName",
           u."type"::text AS "unitType",
           u."sourceType"::text AS "sourceType",
           (u."sourceParentUnitId" IS NOT NULL) AS "hasParent",
           (u."sampleKind" IS NOT NULL) AS "isSample",
           g."kind"::text AS "kind",
           g."growthStage"::text AS "growthStage",
           g."humidWeight"::float8 AS "humidWeight",
           g."dryWeight"::float8 AS "dryWeight",
           g."seedCount" AS "seedCount",
           g."plantCount" AS "plantCount",
           g."effectiveAt" AS "effectiveAt",
           NULL::text AS "orgName",
           NULL::text AS "orgCountry",
           NULL::text AS "orgLicenceClass"
    FROM (${governingStates(asOf)}) g
    JOIN "BiologicalUnit" u ON u."id" = g."unitId"`;
}

/** Every event effective in `[start, endExclusive)`, in the order the ledger replays them. */
function periodRows(start: Date, endExclusive: Date): Promise<LedgerRow[]> {
  return prisma.$queryRaw<LedgerRow[]>`
    SELECT s."id" AS "stateId",
           s."unitId" AS "unitId",
           u."name" AS "unitName",
           u."type"::text AS "unitType",
           u."sourceType"::text AS "sourceType",
           (u."sourceParentUnitId" IS NOT NULL) AS "hasParent",
           (u."sampleKind" IS NOT NULL) AS "isSample",
           s."kind"::text AS "kind",
           s."growthStage"::text AS "growthStage",
           s."humidWeight"::float8 AS "humidWeight",
           s."dryWeight"::float8 AS "dryWeight",
           s."seedCount" AS "seedCount",
           s."plantCount" AS "plantCount",
           s."effectiveAt" AS "effectiveAt",
           o."name" AS "orgName",
           o."country" AS "orgCountry",
           o."licenceClass"::text AS "orgLicenceClass"
    FROM "UnitState" s
    JOIN "BiologicalUnit" u ON u."id" = s."unitId"
    LEFT JOIN "Organization" o ON o."id" = s."organizationId"
    WHERE s."effectiveAt" >= ${start} AND s."effectiveAt" < ${endExclusive}
    ORDER BY s."unitId", s."effectiveAt", s."sequence"`;
}

/** Trim shipped as free lines: not a unit, so never in inventory or in the form's lines. */
async function outboundTrim(start: Date, endExclusive: Date) {
  const [row] = await prisma.$queryRaw<Array<{ lines: number; grams: number }>>`
    SELECT count(*)::int AS "lines", coalesce(sum(i."weightGrams"), 0)::float8 AS "grams"
    FROM "ShipmentItem" i
    JOIN "Shipment" sh ON sh."id" = i."shipmentId"
    WHERE sh."direction" = 'OUTBOUND'
      AND sh."voidedAt" IS NULL
      AND sh."status" IN ('IN_TRANSIT', 'DELIVERED')
      AND i."unitId" IS NULL
      AND i."materialType" = 'TRIM'
      AND sh."shippedDate" >= ${start}
      AND sh."shippedDate" < ${endExclusive}`;
  return { lines: row?.lines ?? 0, grams: Math.round((row?.grams ?? 0) * 1000) / 1000 };
}

function toLedgerState(row: LedgerRow): LedgerState {
  return {
    stateId: row.stateId,
    unitId: row.unitId,
    kind: row.kind,
    growthStage: row.growthStage,
    humidWeight: row.humidWeight,
    dryWeight: row.dryWeight,
    seedCount: row.seedCount,
    plantCount: row.plantCount,
    counterparty: row.orgName
      ? { name: row.orgName, country: row.orgCountry, licenceClass: row.orgLicenceClass }
      : null,
  };
}

/** A quantity in the form's unit: a count, or kilograms for weighed classes and drying loss. */
function formQuantity(cls: TrackedClassId, line: CtlsLineId, qty: number): number {
  return ctlsClass(cls).measure === "kg" || line === "dryingLoss" ? tenthGramsToKg(qty) : qty;
}

const SHIPPING_KINDS: ReadonlySet<UnitStateKind> = new Set([Kind.SHIPPED, Kind.SHIPPED_PART]);

export async function generateCtlsMonthly(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const [currentYear, currentMonth] = formatLabDate(new Date(), zone).split("-").map(Number) as [
    number,
    number,
  ];
  const year = filters.year ?? currentYear;
  const month = filters.month ?? currentMonth;
  const { start, end, endExclusive, label } = monthPeriod(year, month, zone);
  const licenseId = filters.licenseId || (await getLabSettings()).licenceNumber;

  // Opening = the states governing just before the month; closing = those at its last instant.
  const [openingRows, events, closingRows, trim, additionEvents, destructionEvents] =
    await Promise.all([
      governingRows(new Date(start.getTime() - 1)),
      periodRows(start, endExclusive),
      governingRows(end),
      outboundTrim(start, endExclusive),
      getInventoryEvents({
        kinds: [Kind.CREATED, Kind.RECEIVED],
        from: start,
        to: endExclusive,
        newestFirst: false,
      }),
      getInventoryEvents({
        kinds: [Kind.DESTROYED, Kind.WASTED],
        from: start,
        to: endExclusive,
        newestFirst: false,
      }),
    ]);

  const units = new Map<number, LedgerUnit>();
  for (const row of [...openingRows, ...events, ...closingRows]) {
    units.set(row.unitId, {
      id: row.unitId,
      name: row.unitName,
      type: row.unitType,
      sourceType: row.sourceType,
      hasParent: row.hasParent,
      isSample: row.isSample,
    });
  }
  const ledger = buildCtlsLedger({
    units,
    opening: openingRows.map(toLedgerState),
    events: events.map(toLedgerState),
    closing: closingRows.map(toLedgerState),
  });

  const classes: CtlsFormClass[] = TRACKED_CLASS_IDS.map((id) => {
    const cls = ctlsClass(id);
    const counted = ledger.classes[id];
    const lines: CtlsFormClass["lines"] = {};
    for (const line of cls.lines) {
      if (VALUE_LINES.has(line)) continue;
      const qty =
        line === "opening"
          ? counted.opening
          : line === "closing"
            ? counted.closing
            : (counted.lines[line] ?? 0);
      lines[line] = formQuantity(id, line, qty);
    }
    return { id, measure: cls.measure, lines, reconciles: counted.reconciles };
  });

  const eventById = new Map(events.map((row) => [row.stateId, row]));
  const effective = (movement: Movement) =>
    eventById.get(movement.stateId)?.effectiveAt.getTime() ?? 0;
  const movements = [...ledger.movements].sort(
    (a, b) => effective(a) - effective(b) || a.stateId - b.stateId
  );
  const movementRow = (movement: Movement) => {
    const event = eventById.get(movement.stateId);
    const cls = ctlsClass(movement.cls);
    return {
      date: event ? formatLabDate(event.effectiveAt, zone) : "",
      unit: event?.unitName ?? "",
      class: cls.name,
      line: CTLS_LINE_TEXT[movement.line],
      quantity: formQuantity(movement.cls, movement.line, movement.qty),
      measure: movement.line === "dryingLoss" ? "kg" : cls.measure,
      counterparty: event?.orgName ?? "",
      _href: `/inventory/units/${movement.unitId}`,
    };
  };

  const shippingEvents = events.filter((e) => SHIPPING_KINDS.has(e.kind)).length;
  const activeAtClose = closingRows.filter(
    (row) => row.kind !== Kind.SHIPPED && row.kind !== Kind.DESTROYED
  ).length;
  const received = additionEvents.filter((e) => e.kind === Kind.RECEIVED).length;
  const derived = additionEvents.filter((e) => e.parentUnitName !== null).length;

  return {
    meta: {
      reportId: "ctls-monthly",
      title: "CTLS Monthly Report - Unpackaged inventory",
      generatedAt: new Date().toISOString(),
      periodLabel: label,
      licenseId: licenseId ?? undefined,
      subtitle:
        "Unpackaged inventory section of Health Canada's monthly cannabis tracking report (reporting form columns A to JS)",
    },
    ctls: {
      year,
      month,
      classes,
      reconciles: ledger.reconciles,
      cultures: ledger.cultures,
      issues: {
        licenceIdMissing: !licenseId,
        countryMissing: ledger.issues.countryMissing,
        recipientUnclassified: ledger.issues.recipientUnclassified,
        unweighed: ledger.issues.unweighed,
        trimShipped: trim,
      },
      reconciliationNotes: [
        `Months are calendar months in the laboratory time zone (${zone}). Dates are the effective date of each event, not the date it was filed.`,
        "Seed lots are seeds (count). Plants that are not flowering are vegetative cannabis plants; flowering plants are whole cannabis plants. Harvested material is fresh cannabis at its wet weight until a dry weight is recorded, then dried cannabis at its dry weight. Weights are in kilograms to four decimals.",
        "A plant that starts flowering is processed out of vegetative plants and produced into whole plants. A harvested plant is processed out of plants and produced into fresh cannabis. Drying processes fresh cannabis into dried cannabis; the moisture lost is the drying loss.",
        "Material received from, or shipped to, an organization outside Canada is imported or exported. Shipments within Canada are reported by the recipient's licence class.",
        "A lower weight on re-weighing is a drying or processing loss and a higher one an other addition; a seed recount is an other addition or reduction.",
        "Not recorded in Accession Book: packaged inventory, returns, losses and thefts, and book values. Enter them in CTLS if they apply.",
        "Tissue cultures have no class on the form; they are counted separately.",
        ledger.reconciles
          ? "Reconciled: on every class, closing = opening + additions - reductions."
          : "NOT RECONCILED: closing differs from opening + additions - reductions on at least one class; investigate before filing.",
      ],
    },
    kpis: [
      { id: "activeAtClose", label: "Active units (closing)", value: activeAtClose },
      { id: "newUnits", label: "New units", value: additionEvents.length },
      { id: "destructions", label: "Destructions", value: destructionEvents.length },
      { id: "shipments", label: "Shipments", value: shippingEvents },
      { id: "derivations", label: "Derivations", value: derived },
      { id: "externalReceipts", label: "External receipts", value: received },
      { id: "reconciled", label: "Reconciled", value: ledger.reconciles ? "Yes" : "No" },
    ],
    sections: [
      {
        id: "form-movements",
        title: "How each event was reported",
        description: "Every quantity on the form, event by event: the class and line it went on.",
        columns: [
          { key: "date", label: "Date" },
          { key: "unit", label: "Unit" },
          { key: "class", label: "Class" },
          { key: "line", label: "Line" },
          { key: "quantity", label: "Quantity", align: "right" },
          { key: "measure", label: "Unit of measure" },
          { key: "counterparty", label: "Organization" },
        ],
        rows: movements.map(movementRow),
      },
      {
        id: "destruction-detail",
        title: "Destruction detail",
        columns: [
          { key: "date", label: "Date" },
          { key: "unit", label: "Unit" },
          { key: "type", label: "Type" },
          { key: "cultivar", label: "Cultivar" },
          { key: "experiment", label: "Experiment" },
          { key: "comment", label: "Notes" },
        ],
        rows: destructionEvents.map((d) => ({
          date: formatLabDate(d.effectiveAt, zone),
          unit: d.unitName,
          type: d.unitType,
          cultivar: d.cultivarName ?? "—",
          experiment: d.experimentCode ?? "—",
          comment:
            d.kind === Kind.WASTED
              ? `Waste: ${d.shippedWeight ?? "?"} g ${d.shippedMoisture === "DRY" ? "dry" : "wet"}${d.reason ? ` — ${d.reason}` : ""}`
              : (d.reason ?? ""),
          _href: `/inventory/units/${d.unitId}`,
        })),
      },
      {
        id: "additions-detail",
        title: "Additions this month (source records)",
        description:
          "Each unit that entered inventory during the period — drill through to the live profile.",
        columns: [
          { key: "unit", label: "Unit" },
          { key: "type", label: "Type" },
          { key: "source", label: "Source" },
          { key: "cultivar", label: "Cultivar" },
          { key: "experiment", label: "Experiment" },
        ],
        rows: additionEvents.map((e) => ({
          unit: e.unitName,
          type: e.unitType,
          source: e.sourceType ?? "—",
          cultivar: e.cultivarName ?? "—",
          experiment: e.experimentCode ?? "—",
          _href: `/inventory/units/${e.unitId}`,
        })),
      },
    ],
  };
}
