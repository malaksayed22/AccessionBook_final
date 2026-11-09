import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  Measure,
  Moisture,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import {
  materialClassForUnitType,
  sumMaterials,
  type MaterialTotals,
  type MaterialClassId,
} from "@/lib/materials";
import { parseDateRange } from "@/lib/reports/date-range";
import { likeEscape } from "@/lib/search-text";
import { unitStanding, type UnitStanding } from "@/lib/unit-standing";
import { shipmentReadSql, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { seesWholeLab } from "@/lib/roles";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";

export const shipmentInclude = {
  organization: true,
  user: { select: { id: true, name: true } },
  items: {
    include: {
      unit: { select: { id: true, name: true, type: true } },
      cultivar: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.ShipmentInclude;

type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

/** A shipment as the UI consumes it: gram weights are plain numbers, never `Decimal`. */
export type ShipmentWithItems = Omit<ShipmentRow, "items"> & {
  items: Array<Omit<ShipmentRow["items"][number], "weightGrams"> & { weightGrams: number | null }>;
};

function toView(row: ShipmentRow): ShipmentWithItems {
  return {
    ...row,
    items: row.items.map((item) => ({
      ...item,
      weightGrams: item.weightGrams === null ? null : Number(item.weightGrams),
    })),
  };
}

export async function getShipment(id: number): Promise<ShipmentWithItems | null> {
  const row = await prisma.shipment.findFirst({
    where: { id, voidedAt: null },
    include: shipmentInclude,
  });
  return row ? toView(row) : null;
}

export type ShipmentFilters = {
  direction?: string;
  status?: string;
  organizationId?: number;
  from?: Date;
  to?: Date;
};

/** Every shipment with its lines, newest first. For the small ledger; pages use `listShipments`. */
export async function listAllShipments(
  filters: ShipmentFilters = {}
): Promise<ShipmentWithItems[]> {
  const where: Prisma.ShipmentWhereInput = { voidedAt: null };
  if (filters.direction === "INBOUND" || filters.direction === "OUTBOUND") {
    where.direction = filters.direction;
  }
  if (
    filters.status === "DRAFT" ||
    filters.status === "IN_TRANSIT" ||
    filters.status === "DELIVERED" ||
    filters.status === "CANCELLED"
  ) {
    where.status = filters.status;
  }
  if (filters.organizationId) where.organizationId = filters.organizationId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const rows = await prisma.shipment.findMany({
    where,
    include: shipmentInclude,
    orderBy: [{ shippedDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toView);
}

/** Ledger totals split by direction: the net movement across the licence. */
export async function getMaterialLedger(filters: ShipmentFilters = {}) {
  const shipments = await listAllShipments({ ...filters, direction: undefined });
  const inbound = shipments.filter((s) => s.direction === "INBOUND");
  const outbound = shipments.filter((s) => s.direction === "OUTBOUND");
  return {
    inbound: sumMaterials(inbound.flatMap((s) => s.items)),
    outbound: sumMaterials(outbound.flatMap((s) => s.items)),
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    shipments,
  };
}

// --- Shipment list --------------------------------------------------------------------------------

export const SHIPMENT_LIST_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export const SHIPMENT_LIST_STATUSES = ["DRAFT", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const;
export const SHIPMENT_LIST_SORTS = [
  "date",
  "reference",
  "organization",
  "direction",
  "status",
] as const;
export type ShipmentListSort = (typeof SHIPMENT_LIST_SORTS)[number];

export type ShipmentFilterParams = {
  q?: string;
  direction?: ShipmentDirection;
  status?: ShipmentStatus;
  organizationId?: number;
  /** Calendar days (YYYY-MM-DD) in the laboratory time zone, both inclusive. */
  from?: string;
  to?: string;
};

export type ShipmentListParams = ShipmentFilterParams & {
  sort: ShipmentListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type ShipmentListRow = {
  id: number;
  reference: string;
  direction: ShipmentDirection;
  status: ShipmentStatus;
  organization: { id: number; name: string };
  /** The day the movement happened (see `movementDateOf`). */
  movementDate: Date;
  trackingNumber: string | null;
  lineCount: number;
  totals: MaterialTotals;
};

/**
 * The date a movement is filed under, in SQL: when it left for an outbound shipment, when it
 * arrived for an inbound one, else when it was recorded. The list filters and sorts on exactly this.
 */
const MOVEMENT_DATE = Prisma.sql`CASE WHEN s."direction" = 'INBOUND'
  THEN COALESCE(s."deliveredDate", s."shippedDate", s."createdAt")
  ELSE COALESCE(s."shippedDate", s."deliveredDate", s."createdAt") END`;

/** The same rule in TypeScript, for the rows that were selected by it. */
export function movementDateOf(shipment: {
  direction: ShipmentDirection;
  shippedDate: Date | null;
  deliveredDate: Date | null;
  createdAt: Date;
}): Date {
  return shipment.direction === "INBOUND"
    ? (shipment.deliveredDate ?? shipment.shippedDate ?? shipment.createdAt)
    : (shipment.shippedDate ?? shipment.deliveredDate ?? shipment.createdAt);
}
const FROM_ORGANIZATION = Prisma.sql`"Shipment" s JOIN "Organization" o ON o."id" = s."organizationId"`;

function sortExpression(sort: ShipmentListSort): Prisma.Sql {
  switch (sort) {
    case "reference":
      return Prisma.sql`s."reference"`;
    case "organization":
      return Prisma.sql`o."name"`;
    case "direction":
      return Prisma.sql`s."direction"`;
    case "status":
      return Prisma.sql`s."status"`;
    default:
      return MOVEMENT_DATE;
  }
}

/**
 * The WHERE clause shared by the list, its count and the totals, so they can never disagree.
 * Every value is a bound parameter; search text is escaped so `%` and `_` are plain characters.
 */
function filterSql(
  params: ShipmentFilterParams,
  ignore: { direction?: boolean; status?: boolean } = {}
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`s."voidedAt" IS NULL`];
  if (params.direction && !ignore.direction) {
    conditions.push(Prisma.sql`s."direction" = ${params.direction}::"ShipmentDirection"`);
  }
  if (params.status && !ignore.status) {
    conditions.push(Prisma.sql`s."status" = ${params.status}::"ShipmentStatus"`);
  }
  if (params.organizationId) {
    conditions.push(Prisma.sql`s."organizationId" = ${params.organizationId}`);
  }
  const range = parseDateRange(params.from, params.to);
  if (range.start) conditions.push(Prisma.sql`${MOVEMENT_DATE} >= ${range.start}`);
  if (range.endExclusive) conditions.push(Prisma.sql`${MOVEMENT_DATE} < ${range.endExclusive}`);

  const needle = params.q?.trim();
  if (needle) {
    const like = `%${likeEscape(needle)}%`;
    conditions.push(Prisma.sql`(
      s."reference" ILIKE ${like}
      OR s."trackingNumber" ILIKE ${like}
      OR s."licenceNumber" ILIKE ${like}
      OR o."name" ILIKE ${like}
      OR EXISTS (
        SELECT 1 FROM "ShipmentItem" i
        LEFT JOIN "BiologicalUnit" u ON u."id" = i."unitId"
        WHERE i."shipmentId" = s."id"
          AND (i."description" ILIKE ${like} OR u."name" ILIKE ${like})
      )
    )`);
  }
  return Prisma.join(conditions, " AND ");
}

/**
 * One page of shipments. Filtering, search, sorting and paging all happen in the database. Raw SQL
 * is used for the page of ids because the date shown (shipped, else delivered, else recorded) is a
 * COALESCE that Prisma cannot order or filter by; the rows themselves are then loaded by id.
 */
export async function listShipments(
  user: SessionUser,
  params: ShipmentListParams
): Promise<{ rows: ShipmentListRow[]; total: number }> {
  const where = Prisma.sql`${filterSql(params)} AND ${shipmentReadSql(user)}`;
  const direction = params.order === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM ${FROM_ORGANIZATION} WHERE ${where}`,
    prisma.$queryRaw<Array<{ id: number }>>`
      SELECT s."id" FROM ${FROM_ORGANIZATION} WHERE ${where}
      ORDER BY ${sortExpression(params.sort)} ${direction}, s."id" ${direction}
      LIMIT ${params.limit} OFFSET ${(params.page - 1) * params.limit}`,
  ]);
  const total = countRows[0]?.n ?? 0;
  const ids = idRows.map((row) => row.id);
  if (ids.length === 0) return { rows: [], total };

  const shipments = await prisma.shipment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      reference: true,
      direction: true,
      status: true,
      shippedDate: true,
      deliveredDate: true,
      createdAt: true,
      trackingNumber: true,
      organization: { select: { id: true, name: true } },
      items: {
        select: { materialType: true, unitCount: true, weightGrams: true, moisture: true },
      },
    },
  });
  const byId = new Map(shipments.map((s) => [s.id, s]));
  const rows = ids.flatMap((id): ShipmentListRow[] => {
    const s = byId.get(id);
    if (!s) return [];
    return [
      {
        id: s.id,
        reference: s.reference,
        direction: s.direction,
        status: s.status,
        organization: s.organization,
        movementDate: movementDateOf(s),
        trackingNumber: s.trackingNumber,
        lineCount: s.items.length,
        totals: sumMaterials(
          s.items.map((item) => ({
            materialType: item.materialType,
            unitCount: item.unitCount,
            weightGrams: item.weightGrams === null ? null : Number(item.weightGrams),
            moisture: item.moisture,
          }))
        ),
      },
    ];
  });
  return { rows, total };
}

export type ShipmentStats = {
  /** Inbound shipments marked delivered, and what they carried. */
  received: { count: number; totals: MaterialTotals };
  /** Outbound shipments that have left (in transit or delivered), and what they carried. */
  shipped: { count: number; totals: MaterialTotals };
  inTransit: number;
  drafts: number;
  /** How many shipments are in each status, for the status chart. */
  byStatus: Record<ShipmentStatus, number>;
};

/**
 * Headline numbers for the same search, organization and dates as the list (but not its direction
 * or status chips, since each card is its own direction and status).
 */
export async function getShipmentStats(
  user: SessionUser,
  params: ShipmentFilterParams
): Promise<ShipmentStats> {
  const where = Prisma.sql`${filterSql(params, { direction: true, status: true })} AND ${shipmentReadSql(user)}`;
  const [counts, lines] = await Promise.all([
    prisma.$queryRaw<Array<{ direction: ShipmentDirection; status: ShipmentStatus; n: number }>>`
      SELECT s."direction"::text AS direction, s."status"::text AS status, count(*)::int AS n
      FROM ${FROM_ORGANIZATION} WHERE ${where} GROUP BY 1, 2`,
    prisma.$queryRaw<
      Array<{
        direction: ShipmentDirection;
        status: ShipmentStatus;
        materialType: MaterialClass;
        moisture: Moisture | null;
        unitCount: number;
        weightGrams: number;
      }>
    >`
      SELECT s."direction"::text AS direction, s."status"::text AS status,
        i."materialType"::text AS "materialType", i."moisture"::text AS moisture,
        COALESCE(SUM(i."unitCount"), 0)::float8 AS "unitCount",
        COALESCE(SUM(i."weightGrams"), 0)::float8 AS "weightGrams"
      FROM ${FROM_ORGANIZATION} JOIN "ShipmentItem" i ON i."shipmentId" = s."id"
      WHERE ${where} GROUP BY 1, 2, 3, 4`,
  ]);

  const count = (match: (row: (typeof counts)[number]) => boolean) =>
    counts.filter(match).reduce((sum, row) => sum + row.n, 0);
  const totals = (match: (row: (typeof lines)[number]) => boolean) =>
    sumMaterials(lines.filter(match));

  return {
    received: {
      count: count((r) => r.direction === "INBOUND" && r.status === "DELIVERED"),
      totals: totals((r) => r.direction === "INBOUND" && r.status === "DELIVERED"),
    },
    shipped: {
      count: count(
        (r) => r.direction === "OUTBOUND" && (r.status === "IN_TRANSIT" || r.status === "DELIVERED")
      ),
      totals: totals(
        (r) => r.direction === "OUTBOUND" && (r.status === "IN_TRANSIT" || r.status === "DELIVERED")
      ),
    },
    inTransit: count((r) => r.status === "IN_TRANSIT"),
    drafts: count((r) => r.status === "DRAFT"),
    byStatus: {
      DRAFT: count((r) => r.status === "DRAFT"),
      IN_TRANSIT: count((r) => r.status === "IN_TRANSIT"),
      DELIVERED: count((r) => r.status === "DELIVERED"),
      CANCELLED: count((r) => r.status === "CANCELLED"),
    },
  };
}

// --- Shipment detail ------------------------------------------------------------------------------

export type ShipmentTimelineEntry = {
  id: number;
  at: Date;
  actor: string;
  actorId: number | null;
  action: string;
  /** Present when the entry moved the shipment from one status to another. */
  statusFrom: ShipmentStatus | null;
  statusTo: ShipmentStatus | null;
  /** The other fields the entry changed, as stored field names (translated by the page). */
  fields: string[];
  reason: string | null;
};

export type ShipmentDetailItem = {
  id: number;
  description: string;
  materialType: MaterialClass;
  measure: Measure;
  unitCount: number | null;
  weightGrams: number | null;
  moisture: Moisture | null;
  comment: string | null;
  /** The line's cultivar: its own on a free line, the unit's on a unit line. */
  cultivar: { id: number; name: string } | null;
  unit: { id: number; name: string; type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE" } | null;
  /** Where that unit stands now (a shipped unit reads "shipped"). */
  unitStanding: UnitStanding | null;
};

export type ShipmentDetail = {
  id: number;
  reference: string;
  direction: ShipmentDirection;
  status: ShipmentStatus;
  organization: { id: number; name: string; licenceNumber: string | null };
  recordedBy: string;
  recordedById: number;
  shippedDate: Date | null;
  deliveredDate: Date | null;
  trackingNumber: string | null;
  licenceNumber: string | null;
  comment: string | null;
  createdAt: Date;
  items: ShipmentDetailItem[];
  /** Lines that name a unit, including units the viewer may not open. */
  unitLineCount: number;
  totals: MaterialTotals;
  timeline: ShipmentTimelineEntry[];
};

type StoredChange = { field?: unknown; from?: unknown; to?: unknown };

function readChanges(details: unknown): Array<{ field: string; from: unknown; to: unknown }> {
  if (!Array.isArray(details)) return [];
  return (details as StoredChange[]).flatMap((change) =>
    typeof change?.field === "string"
      ? [{ field: change.field, from: change.from, to: change.to }]
      : []
  );
}

const STATUS_VALUES: readonly string[] = SHIPMENT_LIST_STATUSES;
const asStatus = (value: unknown): ShipmentStatus | null =>
  typeof value === "string" && STATUS_VALUES.includes(value) ? (value as ShipmentStatus) : null;

/** The audit entries of one shipment as a timeline: who did what, and which status it moved to. */
export function toTimeline(
  entries: Array<{
    id: number;
    createdAt: Date;
    userId?: number | null;
    userName: string;
    action: string;
    details: unknown;
    reason: string | null;
  }>
): ShipmentTimelineEntry[] {
  return entries.map((entry) => {
    const changes = readChanges(entry.details);
    const status = changes.find((change) => change.field === "status");
    return {
      id: entry.id,
      at: entry.createdAt,
      actor: entry.userName,
      actorId: entry.userId ?? null,
      action: entry.action,
      statusFrom: asStatus(status?.from),
      statusTo: asStatus(status?.to),
      fields: changes.map((change) => change.field).filter((field) => field !== "status"),
      reason: entry.reason,
    };
  });
}

/** One shipment with its lines, the standing of each unit on it, and its history. Null if absent or voided. */
export async function getShipmentDetail(
  user: SessionUser,
  id: number
): Promise<ShipmentDetail | null> {
  const shipment = await prisma.shipment.findFirst({
    where: { id, voidedAt: null },
    include: {
      organization: { select: { id: true, name: true, licenceNumber: true } },
      user: { select: { id: true, name: true } },
      items: {
        orderBy: { id: "asc" },
        include: {
          cultivar: { select: { id: true, name: true } },
          unit: {
            select: {
              id: true,
              name: true,
              type: true,
              cultivar: { select: { id: true, name: true } },
              currentState: { select: { kind: true } },
              holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!shipment) return null;

  const audit = await prisma.auditLog.findMany({
    where: { entityType: "shipment", entityId: shipment.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
      userId: true,
      userName: true,
      action: true,
      details: true,
      reason: true,
    },
  });

  // A unit the member may not read is shown by its line, without the link.
  const readable = new Set(
    (
      await prisma.biologicalUnit.findMany({
        where: {
          AND: [
            unitReadScope(user),
            { id: { in: shipment.items.flatMap((i) => (i.unitId ? [i.unitId] : [])) } },
          ],
        },
        select: { id: true },
      })
    ).map((unit) => unit.id)
  );
  // A member sees a movement only when it carried a unit of one of their experiments.
  if (!seesWholeLab(user) && readable.size === 0) return null;

  const items = shipment.items.map((item): ShipmentDetailItem => ({
    id: item.id,
    description: item.description,
    materialType: item.materialType,
    measure: item.measure,
    unitCount: item.unitCount,
    weightGrams: item.weightGrams === null ? null : Number(item.weightGrams),
    moisture: item.moisture,
    comment: item.comment,
    cultivar:
      item.cultivar ??
      (item.unit && readable.has(item.unit.id) ? (item.unit.cultivar ?? null) : null),
    unit:
      item.unit && readable.has(item.unit.id)
        ? { id: item.unit.id, name: item.unit.name, type: item.unit.type }
        : null,
    unitStanding:
      item.unit && readable.has(item.unit.id)
        ? unitStanding(item.unit.currentState?.kind, item.unit.holds[0]?.kind)
        : null,
  }));

  return {
    id: shipment.id,
    reference: shipment.reference,
    direction: shipment.direction,
    status: shipment.status,
    organization: shipment.organization,
    recordedBy: shipment.user.name,
    recordedById: shipment.user.id,
    shippedDate: shipment.shippedDate,
    deliveredDate: shipment.deliveredDate,
    trackingNumber: shipment.trackingNumber,
    licenceNumber: shipment.licenceNumber,
    comment: shipment.comment,
    createdAt: shipment.createdAt,
    items,
    unitLineCount: shipment.items.filter((item) => item.unitId !== null).length,
    totals: sumMaterials(items),
    timeline: toTimeline(audit),
  };
}

// --- New shipment form ----------------------------------------------------------------------------

export type ShipmentFormOptions = {
  organizations: Array<{ id: number; name: string; licenceNumber: string | null }>;
  cultivars: Array<{ id: number; name: string }>;
};

export async function getShipmentFormOptions(): Promise<ShipmentFormOptions> {
  const [organizations, cultivars] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, licenceNumber: true },
    }),
    prisma.cultivar.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { organizations, cultivars };
}

export type ShippableUnit = {
  id: number;
  name: string;
  type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE";
  cultivarId: number | null;
  cultivarName: string | null;
  locationName: string | null;
  /** What a shipment line for this unit starts from. */
  suggestion: {
    materialType: MaterialClassId;
    unitCount: number | null;
    weightGrams: number | null;
    moisture: "WET" | "DRY" | null;
  };
  /** What is left to ship: grams on each basis for a flower or weighed plant, seeds for a seed lot (null = not recorded). */
  available: { wetGrams: number | null; dryGrams: number | null; seeds: number | null };
};

const SHIPPABLE: Prisma.BiologicalUnitWhereInput = {
  currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } },
  holds: { none: { releasedAt: null } },
};

const shippableSelect = {
  id: true,
  name: true,
  type: true,
  cultivar: { select: { id: true, name: true } },
  currentState: {
    select: {
      humidWeight: true,
      dryWeight: true,
      seedCount: true,
      location: { select: { name: true } },
    },
  },
} satisfies Prisma.BiologicalUnitSelect;

function toShippableUnit(
  unit: Prisma.BiologicalUnitGetPayload<{ select: typeof shippableSelect }>
): ShippableUnit {
  const materialType = materialClassForUnitType(unit.type);
  const state = unit.currentState;
  const dry = state?.dryWeight == null ? null : Number(state.dryWeight);
  const wet = state?.humidWeight == null ? null : Number(state.humidWeight);
  return {
    id: unit.id,
    name: unit.name,
    type: unit.type,
    cultivarId: unit.cultivar?.id ?? null,
    cultivarName: unit.cultivar?.name ?? null,
    locationName: state?.location?.name ?? null,
    suggestion: {
      materialType,
      unitCount:
        unit.type === "FLOWER" ? null : unit.type === "SEEDLOT" ? (state?.seedCount ?? null) : 1,
      weightGrams: unit.type === "FLOWER" ? (dry ?? wet) : null,
      moisture:
        unit.type === "FLOWER" ? (dry !== null ? "DRY" : wet !== null ? "WET" : null) : null,
    },
    available: {
      // A harvested plant that was weighed can ship flower or trim by weight too.
      wetGrams: unit.type === "FLOWER" || unit.type === "PLANT" ? wet : null,
      dryGrams: unit.type === "FLOWER" || unit.type === "PLANT" ? dry : null,
      seeds: unit.type === "SEEDLOT" ? (state?.seedCount ?? null) : null,
    },
  };
}

/**
 * Units that can leave on an outbound shipment right now: still in inventory and not on hold,
 * matching a name search. At most `limit` are returned; the search narrows them.
 */
export async function searchShippableUnits(
  user: SessionUser,
  q: string,
  limit = 8
): Promise<ShippableUnit[]> {
  const needle = q.trim();
  if (needle.length < 1) return [];
  const units = await prisma.biologicalUnit.findMany({
    where: {
      AND: [
        unitReadScope(user),
        SHIPPABLE,
        { name: { contains: likeEscape(needle), mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: Math.min(Math.max(limit, 1), 25),
    select: shippableSelect,
  });
  return units.map(toShippableUnit);
}

/** One unit that can be shipped now, to start a shipment from its page; null if it cannot. */
export async function getShippableUnit(
  user: SessionUser,
  unitId: number
): Promise<ShippableUnit | null> {
  const unit = await prisma.biologicalUnit.findFirst({
    where: { AND: [unitReadScope(user), SHIPPABLE, { id: unitId }] },
    select: shippableSelect,
  });
  return unit ? toShippableUnit(unit) : null;
}
