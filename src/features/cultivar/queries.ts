import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  IncidentSeverity,
  IncidentStatus,
  TestPanel,
  UnitType,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { likeEscape } from "@/lib/search-text";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";

export const CULTIVAR_LIST_USAGE = ["used", "unused"] as const;
export type CultivarListUsage = (typeof CULTIVAR_LIST_USAGE)[number];
export const CULTIVAR_LIST_SORTS = ["name", "units", "thc", "updated"] as const;
export type CultivarListSort = (typeof CULTIVAR_LIST_SORTS)[number];

export type CultivarListParams = {
  q?: string;
  usage?: CultivarListUsage;
  sort: CultivarListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type CultivarStats = {
  /** Every unit ever registered with this cultivar. */
  totalUnits: number;
  /** Units still in inventory. */
  activeUnits: number;
  /** Units that are active and on hold. */
  onHold: number;
  experiments: number;
  locations: number;
};

/** What a cultivar's card shows beside the headline figures: where its units are and in what state. */
export type CultivarDetails = {
  createdAt: Date;
  /** The latest recorded event on any of its units. */
  lastActivity: Date | null;
  /** Every unit of the cultivar by status; the four add up to the total. */
  statuses: { active: number; onHold: number; inactive: number; destroyed: number };
  /** Every unit of the cultivar by kind of material. */
  types: Array<{ type: UnitType; count: number }>;
  /** Plants and flowers still in inventory, by current growth stage. */
  stages: Array<{ stage: string; count: number }>;
  /** Where its units in inventory are, biggest first. */
  locations: Array<{ id: number; name: string; count: number }>;
};

export type CultivarListRow = {
  id: number;
  name: string;
  code: string | null;
  commonName: string | null;
  category: string | null;
  targetThc: number | null;
  targetCbd: number | null;
  vegetativeDays: number | null;
  floweringDays: number | null;
  expectedYieldGrams: number | null;
  comment: string | null;
  stats: CultivarStats;
  details: CultivarDetails;
};

const NO_STATS: CultivarStats = {
  totalUnits: 0,
  activeUnits: 0,
  onHold: 0,
  experiments: 0,
  locations: 0,
};

/** Unit counts per cultivar, for the given cultivars only, in one grouped query. */
async function statsFor(cultivarIds: number[]): Promise<Map<number, CultivarStats>> {
  if (cultivarIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<CultivarStats & { cultivarId: number }>>`
    SELECT u."cultivarId" AS "cultivarId",
           count(*)::int AS "totalUnits",
           count(*) FILTER (WHERE s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED'))::int AS "activeUnits",
           count(*) FILTER (
             WHERE s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')
               AND EXISTS (SELECT 1 FROM "UnitHold" h WHERE h."unitId" = u."id" AND h."releasedAt" IS NULL)
           )::int AS "onHold",
           count(DISTINCT u."experimentId") FILTER (WHERE s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED'))::int AS "experiments",
           count(DISTINCT s."locationId") FILTER (WHERE s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED'))::int AS "locations"
    FROM "BiologicalUnit" u
    LEFT JOIN "UnitState" s ON s."id" = u."currentStateId"
    WHERE u."cultivarId" IN (${Prisma.join(cultivarIds)})
    GROUP BY u."cultivarId"`;
  return new Map(rows.map(({ cultivarId, ...stats }) => [cultivarId, stats]));
}

type DetailRow = {
  cultivarId: number;
  type: UnitType;
  kind: string | null;
  growthStage: string | null;
  locationId: number | null;
  held: boolean;
  last: Date | null;
  n: number;
};

/** The card details of the given cultivars, from one grouped pass over their units' current states. */
async function detailsFor(
  cultivars: Array<{ id: number; createdAt: Date }>
): Promise<Map<number, CultivarDetails>> {
  const result = new Map<number, CultivarDetails>();
  for (const c of cultivars) {
    result.set(c.id, {
      createdAt: c.createdAt,
      lastActivity: null,
      statuses: { active: 0, onHold: 0, inactive: 0, destroyed: 0 },
      types: [],
      stages: [],
      locations: [],
    });
  }
  if (cultivars.length === 0) return result;

  const rows = await prisma.$queryRaw<DetailRow[]>`
    SELECT u."cultivarId" AS "cultivarId", u."type" AS "type", s."kind" AS "kind",
           s."growthStage" AS "growthStage", s."locationId" AS "locationId",
           EXISTS (SELECT 1 FROM "UnitHold" h WHERE h."unitId" = u."id" AND h."releasedAt" IS NULL) AS "held",
           max(s."recordedAt") AS "last", count(*)::int AS "n"
    FROM "BiologicalUnit" u
    LEFT JOIN "UnitState" s ON s."id" = u."currentStateId"
    WHERE u."cultivarId" IN (${Prisma.join(cultivars.map((c) => c.id))})
    GROUP BY 1, 2, 3, 4, 5, 6`;

  const types = new Map<number, Map<UnitType, number>>();
  const stages = new Map<number, Map<string, number>>();
  const places = new Map<number, Map<number, number>>();
  const bump = <K>(map: Map<number, Map<K, number>>, id: number, key: K, n: number) => {
    const inner = map.get(id) ?? new Map<K, number>();
    inner.set(key, (inner.get(key) ?? 0) + n);
    map.set(id, inner);
  };

  for (const row of rows) {
    const detail = result.get(row.cultivarId);
    if (!detail) continue;
    if (row.last && (!detail.lastActivity || row.last > detail.lastActivity)) {
      detail.lastActivity = row.last;
    }
    bump(types, row.cultivarId, row.type, row.n);
    if (row.kind === "DESTROYED") detail.statuses.destroyed += row.n;
    else {
      // A unit with nothing left (all shipped, or merged into a group) is inactive: no stage, no place.
      if (row.kind === "SHIPPED" || row.kind === "MERGED") detail.statuses.inactive += row.n;
      else if (row.held) detail.statuses.onHold += row.n;
      else detail.statuses.active += row.n;
      if (row.kind !== "SHIPPED") {
        if (row.growthStage) bump(stages, row.cultivarId, row.growthStage, row.n);
        if (row.locationId) bump(places, row.cultivarId, row.locationId, row.n);
      }
    }
  }

  const locationIds = [...new Set([...places.values()].flatMap((m) => [...m.keys()]))];
  const names = new Map(
    (locationIds.length
      ? await prisma.location.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, name: true },
        })
      : []
    ).map((l) => [l.id, l.name])
  );

  for (const [id, detail] of result) {
    detail.types = [...(types.get(id) ?? [])]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    detail.stages = [...(stages.get(id) ?? [])]
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);
    detail.locations = [...(places.get(id) ?? [])]
      .map(([locationId, count]) => ({ id: locationId, name: names.get(locationId) ?? "", count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return result;
}

function orderByFor(
  sort: CultivarListSort,
  order: "asc" | "desc"
): Prisma.CultivarOrderByWithRelationInput[] {
  const primary: Prisma.CultivarOrderByWithRelationInput =
    sort === "units"
      ? { units: { _count: order } }
      : sort === "thc"
        ? { targetThc: { sort: order, nulls: "last" } }
        : sort === "updated"
          ? { updatedAt: order }
          : { name: order };
  return [primary, { id: order }];
}

/** One page of the genetic library: search, usage filter, sort and paging happen in the database. */
export async function listCultivars(
  _user: SessionUser,
  params: CultivarListParams
): Promise<{ rows: CultivarListRow[]; total: number }> {
  const needle = params.q?.trim() ? likeEscape(params.q.trim()) : undefined;
  const where: Prisma.CultivarWhereInput = {
    AND: [
      params.usage === "used" ? { units: { some: {} } } : {},
      params.usage === "unused" ? { units: { none: {} } } : {},
      needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" } },
              { code: { contains: needle, mode: "insensitive" } },
              { commonName: { contains: needle, mode: "insensitive" } },
              { category: { contains: needle, mode: "insensitive" } },
              { comment: { contains: needle, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [total, cultivars] = await Promise.all([
    prisma.cultivar.count({ where }),
    prisma.cultivar.findMany({
      where,
      orderBy: orderByFor(params.sort, params.order),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);
  const [stats, details] = await Promise.all([
    statsFor(cultivars.map((c) => c.id)),
    detailsFor(cultivars),
  ]);

  return {
    total,
    rows: cultivars.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      commonName: c.commonName,
      category: c.category,
      targetThc: c.targetThc,
      targetCbd: c.targetCbd,
      vegetativeDays: c.vegetativeDays,
      floweringDays: c.floweringDays,
      expectedYieldGrams: c.expectedYieldGrams,
      comment: c.comment,
      stats: stats.get(c.id) ?? NO_STATS,
      details: details.get(c.id)!,
    })),
  };
}

export type CultivarDetail = CultivarListRow & { createdAt: Date; updatedAt: Date };

export async function getCultivar(_user: SessionUser, id: number): Promise<CultivarDetail | null> {
  const cultivar = await prisma.cultivar.findUnique({ where: { id } });
  if (!cultivar) return null;
  const [stats, details] = await Promise.all([statsFor([id]), detailsFor([cultivar])]);
  return {
    id: cultivar.id,
    name: cultivar.name,
    code: cultivar.code,
    commonName: cultivar.commonName,
    category: cultivar.category,
    targetThc: cultivar.targetThc,
    targetCbd: cultivar.targetCbd,
    vegetativeDays: cultivar.vegetativeDays,
    floweringDays: cultivar.floweringDays,
    expectedYieldGrams: cultivar.expectedYieldGrams,
    comment: cultivar.comment,
    createdAt: cultivar.createdAt,
    updatedAt: cultivar.updatedAt,
    stats: stats.get(id) ?? NO_STATS,
    details: details.get(id)!,
  };
}

export type CultivarUnitRow = {
  id: number;
  name: string;
  type: UnitType;
  experiment: { id: number; ecode: string } | null;
  locationId: number | null;
  locationName: string | null;
  status: "active" | "on-hold" | "destroyed";
};

export const CULTIVAR_UNIT_SORTS = ["name", "type"] as const;
export type CultivarUnitSort = (typeof CULTIVAR_UNIT_SORTS)[number];

/** The units of one cultivar, a page at a time. */
export async function listCultivarUnits(
  user: SessionUser,
  cultivarId: number,
  params: { sort: CultivarUnitSort; order: "asc" | "desc"; page: number; limit: number }
): Promise<{ rows: CultivarUnitRow[]; total: number }> {
  const where: Prisma.BiologicalUnitWhereInput = { AND: [unitReadScope(user), { cultivarId }] };
  const [total, units] = await Promise.all([
    prisma.biologicalUnit.count({ where }),
    prisma.biologicalUnit.findMany({
      where,
      orderBy: [{ [params.sort]: params.order }, { id: params.order }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        name: true,
        type: true,
        experiment: { select: { id: true, ecode: true } },
        currentState: {
          select: { kind: true, locationId: true, location: { select: { name: true } } },
        },
        holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
      },
    }),
  ]);
  return {
    total,
    rows: units.map((unit) => {
      const kind = unit.currentState?.kind;
      const hold = unit.holds[0]?.kind;
      return {
        id: unit.id,
        name: unit.name,
        type: unit.type,
        experiment: unit.experiment,
        locationId: unit.currentState?.locationId ?? null,
        locationName: unit.currentState?.location?.name ?? null,
        status: kind === "DESTROYED" ? "destroyed" : hold ? "on-hold" : "active",
      };
    }),
  };
}

export type CultivarIncidentRow = {
  id: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: Date;
  unit: { id: number; name: string } | null;
};

export type CultivarTestRow = {
  id: number;
  unit: { id: number; name: string };
  panel: TestPanel;
  analyte: string | null;
  value: number | null;
  uom: string | null;
  labName: string | null;
  testedAt: Date;
};

/** Open and closed incidents filed against this genetics (voided ones are left out), newest first. */
export async function listCultivarIncidents(
  _user: SessionUser,
  cultivarId: number,
  take = 10
): Promise<{ rows: CultivarIncidentRow[]; total: number }> {
  const where = { cultivarId, voidedAt: null };
  const [total, rows] = await Promise.all([
    prisma.qualityIncident.count({ where }),
    prisma.qualityIncident.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        createdAt: true,
        unit: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { rows, total };
}

/** Lab results on units of this cultivar (voided ones are left out), newest first. */
export async function listCultivarTests(
  user: SessionUser,
  cultivarId: number,
  take = 10
): Promise<{ rows: CultivarTestRow[]; total: number }> {
  const where: Prisma.LabTestWhereInput = {
    voidedAt: null,
    unit: { is: { AND: [unitReadScope(user), { cultivarId }] } },
  };
  const [total, rows] = await Promise.all([
    prisma.labTest.count({ where }),
    prisma.labTest.findMany({
      where,
      orderBy: [{ testedAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        panel: true,
        analyte: true,
        value: true,
        uom: true,
        labName: true,
        testedAt: true,
        unit: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { rows, total };
}
