import "server-only";
import { Prisma } from "@/generated/prisma/client";
import {
  GrowthStage,
  IncidentStatus,
  ShipmentStatus,
  UnitStateKind,
  UnitType,
} from "@/generated/prisma/enums";
import {
  buildFinding,
  daysBetween,
  OFFENDER_LIMIT,
  STALE_DESTRUCTION_DAYS,
  STUCK_SHIPMENT_DAYS,
  summarizeFindings,
  type ComplianceFinding,
  type ComplianceReport,
  type Offender,
} from "@/lib/compliance";
import { ACTIVE_UNIT_FILTER } from "@/lib/lab";
import { prisma } from "@/server/db";

const MS_PER_DAY = 86_400_000;
const unitHref = (id: number) => `/inventory/units/${id}`;

/** Active units with no recorded location (or, defensively, no recorded state at all). */
const UNLOCATED_UNIT_FILTER = {
  OR: [
    { currentStateId: null },
    { AND: [ACTIVE_UNIT_FILTER, { currentState: { is: { locationId: null } } }] },
  ],
} satisfies Prisma.BiologicalUnitWhereInput;

/** Harvested plants and flowers still in inventory with neither a wet nor a dry weight. */
const HARVEST_WITHOUT_WEIGHT_FILTER = {
  AND: [
    ACTIVE_UNIT_FILTER,
    {
      OR: [
        { type: UnitType.FLOWER },
        {
          type: UnitType.PLANT,
          currentState: {
            is: {
              growthStage: {
                in: [
                  GrowthStage.HARVESTED,
                  GrowthStage.DRYING,
                  GrowthStage.CURING,
                  GrowthStage.STORAGE,
                ],
              },
            },
          },
        },
      ],
    },
    { currentState: { is: { humidWeight: null, dryWeight: null } } },
  ],
} satisfies Prisma.BiologicalUnitWhereInput;

type DestructionException = {
  unitId: number;
  unitName: string;
  effectiveAt: Date;
  recordedAt: Date;
  reason: string | null;
};

/**
 * Destruction records matching a condition: the full count, and the newest few with what an
 * inspector would ask about. Counted and sliced by the database.
 */
async function destructionExceptions(condition: Prisma.Sql) {
  const [counted, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count"
      FROM "UnitState" s
      WHERE s."kind" = 'DESTROYED' AND ${condition}`,
    prisma.$queryRaw<DestructionException[]>`
      SELECT u."id" AS "unitId", u."name" AS "unitName", s."effectiveAt", s."recordedAt",
             s."reason"
      FROM "UnitState" s
      JOIN "BiologicalUnit" u ON u."id" = s."unitId"
      WHERE s."kind" = 'DESTROYED' AND ${condition}
      ORDER BY s."effectiveAt" DESC, s."id" DESC
      LIMIT ${OFFENDER_LIMIT}`,
  ]);
  return { count: counted[0]?.count ?? 0, rows };
}

const UNDOCUMENTED_DESTRUCTION = Prisma.sql`(
  s."reason" IS NULL OR btrim(s."reason") = ''
)`;
const LATE_DESTRUCTION = Prisma.sql`(
  floor(extract(epoch FROM (s."recordedAt" - s."effectiveAt")) / 86400) > ${STALE_DESTRUCTION_DAYS}
)`;

/** A list of units named `name` for a unit filter: the count and the first few. */
async function unitExceptions(where: Prisma.BiologicalUnitWhereInput) {
  const [count, rows] = await Promise.all([
    prisma.biologicalUnit.count({ where }),
    prisma.biologicalUnit.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: OFFENDER_LIMIT,
    }),
  ]);
  return { count, rows };
}

const onUnit = (u: { id: number; name: string }, detail: Offender["detail"]): Offender => ({
  id: u.id,
  label: u.name,
  detail,
  href: unitHref(u.id),
});

/**
 * Runs every readiness check. Counts and the first few offenders per check come from the
 * database; nothing here loads a whole table. Checks are laboratory-wide (an inspector sees the
 * whole licence), so they are not narrowed by `unitReadScope`.
 */
export async function runComplianceChecks(now: Date = new Date()): Promise<ComplianceReport> {
  const unscannedMoves = {
    kind: UnitStateKind.MOVED,
    scanConfirmed: false,
  } satisfies Prisma.UnitStateWhereInput;
  // Cancelled and voided shipments never moved material, so they carry no licence duty.
  const noLicence = {
    voidedAt: null,
    status: { not: ShipmentStatus.CANCELLED },
    OR: [{ licenceNumber: null }, { licenceNumber: "" }],
  } satisfies Prisma.ShipmentWhereInput;
  const stuck = {
    voidedAt: null,
    status: ShipmentStatus.IN_TRANSIT,
    shippedDate: { lt: new Date(now.getTime() - STUCK_SHIPMENT_DAYS * MS_PER_DAY) },
  } satisfies Prisma.ShipmentWhereInput;
  const openIncident = {
    status: { not: IncidentStatus.CLOSED },
    voidedAt: null,
  } satisfies Prisma.QualityIncidentWhereInput;
  const activeHold = { releasedAt: null } satisfies Prisma.UnitHoldWhereInput;

  const [
    unlocated,
    noCultivar,
    noProvenance,
    undocumented,
    late,
    unscannedCount,
    unscannedList,
    noLicenceCount,
    noLicenceList,
    stuckCount,
    stuckList,
    noWeight,
    noExperiment,
    holdCount,
    holdList,
    incidentCount,
    incidentList,
  ] = await Promise.all([
    unitExceptions(UNLOCATED_UNIT_FILTER),
    unitExceptions({ cultivarId: null }),
    unitExceptions({ sourceType: null }),
    destructionExceptions(UNDOCUMENTED_DESTRUCTION),
    destructionExceptions(LATE_DESTRUCTION),
    prisma.unitState.count({ where: unscannedMoves }),
    prisma.unitState.findMany({
      where: unscannedMoves,
      select: {
        unit: { select: { id: true, name: true } },
        location: { select: { name: true } },
      },
      orderBy: { effectiveAt: "desc" },
      take: OFFENDER_LIMIT,
    }),
    prisma.shipment.count({ where: noLicence }),
    prisma.shipment.findMany({
      where: noLicence,
      select: { id: true, reference: true, organization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: OFFENDER_LIMIT,
    }),
    prisma.shipment.count({ where: stuck }),
    prisma.shipment.findMany({
      where: stuck,
      select: { id: true, reference: true, shippedDate: true },
      orderBy: { shippedDate: "asc" },
      take: OFFENDER_LIMIT,
    }),
    unitExceptions(HARVEST_WITHOUT_WEIGHT_FILTER),
    unitExceptions({ experimentId: null }),
    prisma.unitHold.count({ where: activeHold }),
    prisma.unitHold.findMany({
      where: activeHold,
      select: { kind: true, reason: true, unit: { select: { id: true, name: true } } },
      orderBy: { placedAt: "desc" },
      take: OFFENDER_LIMIT,
    }),
    prisma.qualityIncident.count({ where: openIncident }),
    prisma.qualityIncident.findMany({
      where: openIncident,
      select: {
        id: true,
        title: true,
        severity: true,
        unit: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: OFFENDER_LIMIT,
    }),
  ]);

  const findings: ComplianceFinding[] = [
    buildFinding(
      "inventory-located",
      unlocated.count,
      unlocated.rows.map((u) => onUnit(u, { key: "noLocation", params: {} }))
    ),
    buildFinding(
      "cultivar-attribution",
      noCultivar.count,
      noCultivar.rows.map((u) => onUnit(u, { key: "noCultivar", params: {} }))
    ),
    buildFinding(
      "provenance-recorded",
      noProvenance.count,
      noProvenance.rows.map((u) => onUnit(u, { key: "noSource", params: {} }))
    ),
    buildFinding(
      "destruction-documented",
      undocumented.count,
      undocumented.rows.map((d) =>
        onUnit(
          { id: d.unitId, name: d.unitName },
          {
            key: "destroyedNoReason",
            params: { days: daysBetween(d.effectiveAt, now) },
          }
        )
      )
    ),
    buildFinding(
      "destruction-filed-promptly",
      late.count,
      late.rows.map((d) =>
        onUnit(
          { id: d.unitId, name: d.unitName },
          { key: "filedLate", params: { days: daysBetween(d.effectiveAt, d.recordedAt) } }
        )
      )
    ),
    buildFinding(
      "transfers-scanned",
      unscannedCount,
      unscannedList.map((move) =>
        onUnit(
          move.unit,
          move.location?.name
            ? { key: "movedWithoutScan", params: { location: move.location.name } }
            : { key: "movedWithoutScanUnknown", params: {} }
        )
      )
    ),
    buildFinding(
      "shipment-licence",
      noLicenceCount,
      noLicenceList.map((s) => ({
        id: s.id,
        label: s.reference,
        detail: { key: "noLicence", params: { organization: s.organization.name } },
        href: `/inventory/materials/${s.id}`,
      }))
    ),
    buildFinding(
      "shipments-reconciled",
      stuckCount,
      stuckList.map((s) => ({
        id: s.id,
        label: s.reference,
        detail: {
          key: "inTransitDays",
          params: { days: s.shippedDate ? daysBetween(s.shippedDate, now) : 0 },
        },
        href: `/inventory/materials/${s.id}`,
      }))
    ),
    buildFinding(
      "harvest-weights",
      noWeight.count,
      noWeight.rows.map((u) => onUnit(u, { key: "noWeight", params: {} }))
    ),
    buildFinding(
      "experiment-attribution",
      noExperiment.count,
      noExperiment.rows.map((u) => onUnit(u, { key: "noExperiment", params: {} }))
    ),
    buildFinding(
      "quality-holds",
      holdCount,
      holdList.map((h) =>
        onUnit(h.unit, { key: "hold", params: { kind: h.kind, reason: h.reason } })
      )
    ),
    buildFinding(
      "open-incidents",
      incidentCount,
      incidentList.map((i) => ({
        id: i.id,
        label: i.unit?.name ?? i.title,
        detail: { key: "incident", params: { severity: i.severity, title: i.title } },
        href: i.unit ? unitHref(i.unit.id) : "/quality",
      }))
    ),
  ];

  return summarizeFindings(findings, now);
}
