import { Prisma } from "@/generated/prisma/client";
import type { GrowthStage, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

/**
 * Inventory events (UnitState rows) for a period, joined to the names the reports print, in one
 * query. `previous*` come from the unit's preceding event (sequence - 1): the from-location of a
 * move, the from-stage of a stage change.
 */
export type InventoryEvent = {
  stateId: number;
  unitId: number;
  unitName: string;
  unitType: UnitType;
  sourceType: string | null;
  parentUnitName: string | null;
  cultivarName: string | null;
  experimentId: number | null;
  experimentCode: string | null;
  kind: UnitStateKind;
  effectiveAt: Date;
  recordedAt: Date;
  recordedByName: string;
  locationName: string | null;
  previousLocationName: string | null;
  growthStage: GrowthStage | null;
  previousStage: GrowthStage | null;
  /** Grams. */
  humidWeight: number | null;
  /** Grams. */
  dryWeight: number | null;
  seedCount: number | null;
  /** On a shipment: how much left (grams on `shippedMoisture`, or a count). */
  shippedWeight: number | null;
  shippedMoisture: "WET" | "DRY" | null;
  shippedCount: number | null;
  organizationName: string | null;
  scanConfirmed: boolean;
  reason: string | null;
  witnessName: string | null;
  comment: string | null;
  plantCount: number | null;
};

export type EventQuery = {
  kinds: UnitStateKind[];
  /** Inclusive lower bound on effectiveAt. */
  from?: Date | null;
  /** Exclusive upper bound on effectiveAt. */
  to?: Date | null;
  unitType?: string;
  /** Moves into or out of this location. */
  locationId?: number;
  newestFirst?: boolean;
};

export async function getInventoryEvents(query: EventQuery): Promise<InventoryEvent[]> {
  const conditions = [
    Prisma.sql`s."kind"::text = ANY(${query.kinds as string[]})`,
    ...(query.from ? [Prisma.sql`s."effectiveAt" >= ${query.from}`] : []),
    ...(query.to ? [Prisma.sql`s."effectiveAt" < ${query.to}`] : []),
    ...(query.unitType ? [Prisma.sql`u."type"::text = ${query.unitType}`] : []),
    ...(query.locationId
      ? [Prisma.sql`(s."locationId" = ${query.locationId} OR p."locationId" = ${query.locationId})`]
      : []),
  ];
  const direction = query.newestFirst === false ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return prisma.$queryRaw<InventoryEvent[]>`
    SELECT s."id" AS "stateId",
           u."id" AS "unitId",
           u."name" AS "unitName",
           u."type"::text AS "unitType",
           u."sourceType"::text AS "sourceType",
           pu."name" AS "parentUnitName",
           c."name" AS "cultivarName",
           u."experimentId" AS "experimentId",
           e."ecode" AS "experimentCode",
           s."kind"::text AS "kind",
           s."effectiveAt" AS "effectiveAt",
           s."recordedAt" AS "recordedAt",
           rb."name" AS "recordedByName",
           l."name" AS "locationName",
           pl."name" AS "previousLocationName",
           s."growthStage"::text AS "growthStage",
           p."growthStage"::text AS "previousStage",
           s."humidWeight"::float8 AS "humidWeight",
           s."dryWeight"::float8 AS "dryWeight",
           s."seedCount" AS "seedCount",
           s."shippedWeight"::float8 AS "shippedWeight",
           s."shippedMoisture"::text AS "shippedMoisture",
           s."shippedCount" AS "shippedCount",
           o."name" AS "organizationName",
           s."scanConfirmed" AS "scanConfirmed",
           s."reason" AS "reason",
           w."name" AS "witnessName",
           s."comment" AS "comment",
           s."plantCount" AS "plantCount"
    FROM "UnitState" s
    JOIN "BiologicalUnit" u ON u."id" = s."unitId"
    JOIN "User" rb ON rb."id" = s."recordedById"
    LEFT JOIN "BiologicalUnit" pu ON pu."id" = u."sourceParentUnitId"
    LEFT JOIN "Cultivar" c ON c."id" = u."cultivarId"
    LEFT JOIN "Experiment" e ON e."id" = u."experimentId"
    LEFT JOIN "Location" l ON l."id" = s."locationId"
    LEFT JOIN "UnitState" p ON p."unitId" = s."unitId" AND p."sequence" = s."sequence" - 1
    LEFT JOIN "Location" pl ON pl."id" = p."locationId"
    LEFT JOIN "Organization" o ON o."id" = s."organizationId"
    LEFT JOIN "User" w ON w."id" = s."witnessId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY s."effectiveAt" ${direction}, s."id" ${direction}`;
}
