import { Prisma } from "@/generated/prisma/client";
import type { GrowthStage, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

/**
 * "The state of a unit at time T" is its newest event with `effectiveAt <= T`, ties broken by
 * `sequence`. SHIPPED and DESTROYED are terminal: once one is effective the unit has left
 * inventory, even if a back-dated event with a later `effectiveAt` was filed before it. A unit is
 * active at T iff it has an event by T and none of them is terminal.
 *
 * Everything here runs as one set-based query (DISTINCT ON), never a query per unit.
 */
export type SnapshotState = {
  stateId: number;
  unitId: number;
  unitName: string;
  unitType: UnitType;
  cultivarName: string | null;
  experimentId: number | null;
  experimentCode: string | null;
  locationId: number | null;
  locationName: string | null;
  kind: UnitStateKind;
  effectiveAt: Date;
  growthStage: GrowthStage | null;
  /** Grams. */
  humidWeight: number | null;
  /** Grams. */
  dryWeight: number | null;
  seedCount: number | null;
};

export type SnapshotFilters = {
  unitType?: string;
  locationId?: number;
  experimentId?: number;
};

const TERMINAL_KINDS = Prisma.sql`('SHIPPED', 'DESTROYED', 'MERGED')`;

/** Each unit's governing state at `asOf`: terminal first, then newest effectiveAt, then sequence. */
export function governingStates(asOf: Date) {
  return Prisma.sql`
    SELECT DISTINCT ON (s."unitId") s.*
    FROM "UnitState" s
    WHERE s."effectiveAt" <= ${asOf}
    ORDER BY s."unitId",
             (s."kind" IN ${TERMINAL_KINDS}) DESC,
             s."effectiveAt" DESC,
             s."sequence" DESC`;
}

/** Active units' states at a point in time, joined to the names reports need. */
export async function getActiveStatesAtDate(
  asOf: Date,
  filters: SnapshotFilters = {}
): Promise<SnapshotState[]> {
  const conditions = [
    Prisma.sql`g."kind" NOT IN ${TERMINAL_KINDS}`,
    ...(filters.unitType ? [Prisma.sql`u."type"::text = ${filters.unitType}`] : []),
    ...(filters.locationId ? [Prisma.sql`g."locationId" = ${filters.locationId}`] : []),
    ...(filters.experimentId ? [Prisma.sql`u."experimentId" = ${filters.experimentId}`] : []),
  ];
  return prisma.$queryRaw<SnapshotState[]>`
    SELECT g."id" AS "stateId",
           u."id" AS "unitId",
           u."name" AS "unitName",
           u."type"::text AS "unitType",
           c."name" AS "cultivarName",
           u."experimentId" AS "experimentId",
           e."ecode" AS "experimentCode",
           g."locationId" AS "locationId",
           l."name" AS "locationName",
           g."kind"::text AS "kind",
           g."effectiveAt" AS "effectiveAt",
           g."growthStage"::text AS "growthStage",
           g."humidWeight"::float8 AS "humidWeight",
           g."dryWeight"::float8 AS "dryWeight",
           g."seedCount" AS "seedCount"
    FROM (${governingStates(asOf)}) g
    JOIN "BiologicalUnit" u ON u."id" = g."unitId"
    LEFT JOIN "Cultivar" c ON c."id" = u."cultivarId"
    LEFT JOIN "Experiment" e ON e."id" = u."experimentId"
    LEFT JOIN "Location" l ON l."id" = g."locationId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY u."name" ASC`;
}

export type UnitStateAtDate = {
  stateId: number;
  sequence: number;
  kind: UnitStateKind;
  effectiveAt: Date;
  locationId: number | null;
  growthStage: GrowthStage | null;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  /** False once a SHIPPED or DESTROYED event is effective. */
  active: boolean;
};

/** One unit's governing state at `asOf`, or null if it did not exist yet. */
export async function getUnitStateAtDate(
  unitId: number,
  asOf: Date
): Promise<UnitStateAtDate | null> {
  const [row] = await prisma.$queryRaw<Array<Omit<UnitStateAtDate, "active">>>`
    SELECT s."id" AS "stateId",
           s."sequence" AS "sequence",
           s."kind"::text AS "kind",
           s."effectiveAt" AS "effectiveAt",
           s."locationId" AS "locationId",
           s."growthStage"::text AS "growthStage",
           s."humidWeight"::float8 AS "humidWeight",
           s."dryWeight"::float8 AS "dryWeight",
           s."seedCount" AS "seedCount"
    FROM "UnitState" s
    WHERE s."unitId" = ${unitId} AND s."effectiveAt" <= ${asOf}
    ORDER BY (s."kind" IN ${TERMINAL_KINDS}) DESC, s."effectiveAt" DESC, s."sequence" DESC
    LIMIT 1`;
  if (!row) return null;
  return { ...row, active: row.kind !== "SHIPPED" && row.kind !== "DESTROYED" };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function sumWeights(states: SnapshotState[]): { humid: number | null; dry: number | null } {
  let humid = 0;
  let dry = 0;
  let hasHumid = false;
  let hasDry = false;
  for (const s of states) {
    if (s.humidWeight != null) {
      humid += s.humidWeight;
      hasHumid = true;
    }
    if (s.dryWeight != null) {
      dry += s.dryWeight;
      hasDry = true;
    }
  }
  return { humid: hasHumid ? round3(humid) : null, dry: hasDry ? round3(dry) : null };
}

export function sumSeedCount(states: SnapshotState[]): number | null {
  let total = 0;
  let has = false;
  for (const s of states) {
    if (s.unitType === "SEEDLOT" && s.seedCount != null) {
      total += s.seedCount;
      has = true;
    }
  }
  return has ? total : null;
}
