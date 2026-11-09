import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { likeEscape } from "@/lib/search-text";
import { prisma } from "@/server/db";
import type { CapacityMeasure } from "@/lib/location-capacity";

export const LOCATION_LIST_STATUSES = ["active", "retired"] as const;
export type LocationListStatus = (typeof LOCATION_LIST_STATUSES)[number];
export const LOCATION_LIST_SORTS = ["name", "units", "capacity"] as const;
export type LocationListSort = (typeof LOCATION_LIST_SORTS)[number];

export type LocationListParams = {
  q?: string;
  status?: LocationListStatus;
  sort: LocationListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type LocationListRow = {
  id: number;
  name: string;
  /** The room's short code (R-001). */
  code: string | null;
  address: string | null;
  comment: string | null;
  /** What the location can hold, in `capacityMeasure`; null when no limit is set. */
  capacity: number | null;
  capacityMeasure: CapacityMeasure;
  kind: "ROOM" | "ROW" | "RACK" | "SHELF" | "AREA";
  /** The location this one is inside. */
  parent: { id: number; name: string } | null;
  active: boolean;
  /** Units in inventory stored here right now (shipped and destroyed units do not count). */
  units: number;
  /** Plants among them, every plant of a group counted. */
  plants: number;
  /** Grams of weighed material among them: dry weight once recorded, else wet. */
  grams: number;
  experiments: number;
};

type RawRow = Omit<LocationListRow, "parent"> & {
  parentId: number | null;
  parentName: string | null;
};

/** Units in inventory per location, in the database: one pass over current states. */
const OCCUPANCY = Prisma.sql`
  SELECT s."locationId" AS "locationId",
         count(*)::int AS "units",
         COALESCE(SUM(CASE WHEN u."type" = 'PLANT' THEN COALESCE(s."plantCount", 1) ELSE 0 END), 0)::int AS "plants",
         COALESCE(SUM(COALESCE(s."dryWeight", s."humidWeight", 0)), 0)::float8 AS "grams",
         count(DISTINCT u."experimentId")::int AS "experiments"
  FROM "BiologicalUnit" u
  JOIN "UnitState" s ON s."id" = u."currentStateId"
  WHERE s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED') AND s."locationId" IS NOT NULL
  GROUP BY s."locationId"`;

function whereFor(params: Pick<LocationListParams, "q" | "status">): Prisma.Sql {
  // Locations are rooms: the retired levels inside rooms (rows, racks, shelves) are not listed.
  const conditions: Prisma.Sql[] = [Prisma.sql`l."parentId" IS NULL`];
  if (params.status) conditions.push(Prisma.sql`l."active" = ${params.status === "active"}`);
  const needle = params.q?.trim();
  if (needle) {
    // A bound parameter with escaped wildcards: the text is searched for, never interpreted.
    const pattern = `%${likeEscape(needle)}%`;
    conditions.push(
      Prisma.sql`(l."name" ILIKE ${pattern} OR l."code" ILIKE ${pattern} OR l."address" ILIKE ${pattern} OR l."comment" ILIKE ${pattern})`
    );
  }
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

function orderFor(sort: LocationListSort, order: "asc" | "desc"): Prisma.Sql {
  const direction = order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // The id is the tie-break, so pages never repeat or skip a row.
  switch (sort) {
    case "units":
      return Prisma.sql`ORDER BY COALESCE(o."units", 0) ${direction}, l."id" ASC`;
    case "capacity":
      return Prisma.sql`ORDER BY l."capacity" ${direction} NULLS LAST, l."id" ASC`;
    default:
      return Prisma.sql`ORDER BY lower(l."name") ${direction}, l."id" ASC`;
  }
}

/** One page of locations with their occupancy; filtering, sorting and paging are done by the database. */
export async function listLocations(
  _user: SessionUser,
  params: LocationListParams
): Promise<{ rows: LocationListRow[]; total: number }> {
  const where = whereFor(params);
  const offset = (params.page - 1) * params.limit;

  const [counted, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS "total" FROM "Location" l ${where}`,
    prisma.$queryRaw<RawRow[]>`
      SELECT l."id", l."name", l."code", l."address", l."comment", l."capacity", l."active",
             l."capacityMeasure"::text AS "capacityMeasure", l."kind"::text AS "kind",
             p."id" AS "parentId", p."name" AS "parentName",
             COALESCE(o."units", 0)::int AS "units",
             COALESCE(o."plants", 0)::int AS "plants",
             COALESCE(o."grams", 0)::float8 AS "grams",
             COALESCE(o."experiments", 0)::int AS "experiments"
      FROM "Location" l
      LEFT JOIN "Location" p ON p."id" = l."parentId"
      LEFT JOIN (${OCCUPANCY}) o ON o."locationId" = l."id"
      ${where}
      ${orderFor(params.sort, params.order)}
      LIMIT ${params.limit} OFFSET ${offset}`,
  ]);
  return {
    rows: rows.map(({ parentId, parentName, ...row }) => ({
      ...row,
      parent: parentId !== null && parentName !== null ? { id: parentId, name: parentName } : null,
    })),
    total: counted[0]?.total ?? 0,
  };
}

export type LocationOverview = {
  active: number;
  retired: number;
  /** Units in inventory with a location. */
  unitsStored: number;
  /** Active locations with a limit that are full or over it. */
  atCapacity: number;
};

/** Headline numbers for the top of the page (whole laboratory, not the current filter). */
export async function getLocationOverview(_user: SessionUser): Promise<LocationOverview> {
  const [row] = await prisma.$queryRaw<
    Array<{ active: number; retired: number; unitsStored: number; atCapacity: number }>
  >`
    SELECT count(*) FILTER (WHERE l."active")::int AS "active",
           count(*) FILTER (WHERE NOT l."active")::int AS "retired",
           COALESCE(sum(o."units"), 0)::int AS "unitsStored",
           count(*) FILTER (
             WHERE l."active" AND l."capacity" IS NOT NULL AND (
               CASE l."capacityMeasure"
                 WHEN 'PLANTS' THEN COALESCE(o."plants", 0)
                 WHEN 'WEIGHT' THEN COALESCE(o."grams", 0)
                 ELSE COALESCE(o."units", 0)
               END
             ) >= l."capacity"
           )::int AS "atCapacity"
    FROM "Location" l
    LEFT JOIN (${OCCUPANCY}) o ON o."locationId" = l."id"
    WHERE l."parentId" IS NULL`;
  return row ?? { active: 0, retired: 0, unitsStored: 0, atCapacity: 0 };
}

export type LocationSummary = {
  id: number;
  name: string;
  address: string | null;
  active: boolean;
  capacity: number | null;
  /** Units in inventory here. */
  occupancy: number;
  /** Everything stored here: on hold or free, and by kind of material. */
  here: { active: number; onHold: number; types: Array<{ type: UnitType; count: number }> };
  /** The cultivar the summary was opened from, when there is one. */
  cultivar: null | {
    id: number;
    name: string;
    active: number;
    onHold: number;
    types: Array<{ type: UnitType; count: number }>;
    stages: Array<{ stage: string; count: number }>;
  };
  /** The experiments with the most units here. */
  experiments: Array<{ id: number; ecode: string; name: string; count: number }>;
};

/**
 * What is in one location right now (units in inventory only), and, given a cultivar, how much of it is
 * that cultivar. Counts only, in one grouped pass over the current states.
 */
export async function getLocationSummary(
  _user: SessionUser,
  locationId: number,
  cultivarId?: number
): Promise<LocationSummary | null> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, address: true, active: true, capacity: true },
  });
  if (!location) return null;

  const rows = await prisma.$queryRaw<
    Array<{
      type: UnitType;
      cultivarId: number | null;
      experimentId: number | null;
      growthStage: string | null;
      held: boolean;
      n: number;
    }>
  >`
    SELECT u."type" AS "type", u."cultivarId" AS "cultivarId", u."experimentId" AS "experimentId",
           s."growthStage" AS "growthStage",
           EXISTS (SELECT 1 FROM "UnitHold" h WHERE h."unitId" = u."id" AND h."releasedAt" IS NULL) AS "held",
           count(*)::int AS "n"
    FROM "BiologicalUnit" u
    JOIN "UnitState" s ON s."id" = u."currentStateId"
    WHERE s."locationId" = ${locationId} AND s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')
    GROUP BY 1, 2, 3, 4, 5`;

  const here = { active: 0, onHold: 0 };
  const hereTypes = new Map<UnitType, number>();
  const mine = { active: 0, onHold: 0 };
  const mineTypes = new Map<UnitType, number>();
  const mineStages = new Map<string, number>();
  const experiments = new Map<number, number>();
  const add = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);

  for (const row of rows) {
    if (row.held) here.onHold += row.n;
    else here.active += row.n;
    add(hereTypes, row.type, row.n);
    if (row.experimentId) add(experiments, row.experimentId, row.n);
    if (cultivarId !== undefined && row.cultivarId === cultivarId) {
      if (row.held) mine.onHold += row.n;
      else mine.active += row.n;
      add(mineTypes, row.type, row.n);
      if (row.growthStage) add(mineStages, row.growthStage, row.n);
    }
  }

  const biggest = [...experiments].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const [named, cultivar] = await Promise.all([
    biggest.length
      ? prisma.experiment.findMany({
          where: { id: { in: biggest.map(([id]) => id) } },
          select: { id: true, ecode: true, name: true },
        })
      : [],
    cultivarId !== undefined
      ? prisma.cultivar.findUnique({ where: { id: cultivarId }, select: { id: true, name: true } })
      : null,
  ]);
  const byCount = <K>(map: Map<K, number>) =>
    [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

  return {
    ...location,
    occupancy: here.active + here.onHold,
    here: {
      ...here,
      types: byCount(hereTypes).map(({ key, count }) => ({ type: key, count })),
    },
    cultivar: cultivar
      ? {
          ...cultivar,
          ...mine,
          types: byCount(mineTypes).map(({ key, count }) => ({ type: key, count })),
          stages: byCount(mineStages).map(({ key, count }) => ({ stage: key, count })),
        }
      : null,
    experiments: biggest.flatMap(([id, count]) => {
      const experiment = named.find((e) => e.id === id);
      return experiment ? [{ ...experiment, count }] : [];
    }),
  };
}

export type LocationProfile = {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  /** The room's description. */
  comment: string | null;
  capacity: number | null;
  capacityMeasure: CapacityMeasure;
  active: boolean;
  createdAt: Date;
  /** What is stored here now, in the room's own measure and counted every way. */
  occupancy: { units: number; plants: number; grams: number; experiments: number };
  /** Units in inventory here, by status. */
  statuses: { active: number; onHold: number };
  /** Units in inventory here, newest first (at most `UNITS_SHOWN`). */
  units: Array<{
    id: number;
    name: string;
    type: UnitType;
    cultivar: { id: number; name: string } | null;
    experiment: { id: number; ecode: string } | null;
    held: boolean;
    since: Date;
  }>;
};

export const UNITS_SHOWN = 100;

/** A room's own page: its details, what it holds and the units stored there now. */
export async function getLocationProfile(
  _user: SessionUser,
  id: number
): Promise<LocationProfile | null> {
  const location = await prisma.location.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      comment: true,
      capacity: true,
      capacityMeasure: true,
      active: true,
      createdAt: true,
    },
  });
  if (!location) return null;

  const [occupancy, units] = await Promise.all([
    prisma.$queryRaw<Array<{ units: number; plants: number; grams: number; experiments: number }>>`
      SELECT o."units", o."plants", o."grams", o."experiments"
      FROM (${OCCUPANCY}) o WHERE o."locationId" = ${id}`,
    prisma.biologicalUnit.findMany({
      where: {
        currentState: {
          is: { locationId: id, kind: { notIn: ["SHIPPED", "DESTROYED", "MERGED"] } },
        },
      },
      orderBy: { currentState: { effectiveAt: "desc" } },
      take: UNITS_SHOWN,
      select: {
        id: true,
        name: true,
        type: true,
        cultivar: { select: { id: true, name: true } },
        experiment: { select: { id: true, ecode: true } },
        holds: { where: { releasedAt: null }, select: { id: true }, take: 1 },
        currentState: { select: { effectiveAt: true } },
      },
    }),
  ]);
  const rows = units.map((u) => ({
    id: u.id,
    name: u.name,
    type: u.type,
    cultivar: u.cultivar,
    experiment: u.experiment,
    held: u.holds.length > 0,
    since: u.currentState?.effectiveAt ?? location.createdAt,
  }));
  const held = await prisma.biologicalUnit.count({
    where: {
      currentState: { is: { locationId: id, kind: { notIn: ["SHIPPED", "DESTROYED", "MERGED"] } } },
      holds: { some: { releasedAt: null } },
    },
  });
  const here = occupancy[0] ?? { units: 0, plants: 0, grams: 0, experiments: 0 };
  return {
    ...location,
    capacityMeasure: location.capacityMeasure as CapacityMeasure,
    occupancy: here,
    statuses: { active: here.units - held, onHold: held },
    units: rows,
  };
}
