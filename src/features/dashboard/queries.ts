import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { UnitStateKind, UnitType, type GrowthStage } from "@/generated/prisma/enums";
import { listRecentAuditEntries, type AuditEntryRow } from "@/features/audit/queries";
import { getUnitStatusCounts, type UnitStatusCounts } from "@/features/unit/queries";
import type { SessionUser } from "@/lib/auth";
import { ACTIVE_UNIT_FILTER } from "@/lib/lab";

import { prisma } from "@/server/db";
import type { Role } from "@/lib/roles";
import { canReadCompliance, seesWholeLab } from "@/lib/roles";

const RUNNING_EXPERIMENTS_SHOWN = 6;
const LOCATIONS_SHOWN = 8;
const RECENT_SHOWN = 8;
const MEMBERS_SHOWN = 50;
const TERMINAL = [UnitStateKind.SHIPPED, UnitStateKind.DESTROYED, UnitStateKind.MERGED];
const UNIT_TYPES = [UnitType.PLANT, UnitType.SEEDLOT, UnitType.FLOWER, UnitType.CULTURE] as const;

/** Which of the two dashboards a user sees. */
export type DashboardView = "admin" | "member";

export type RunningExperiment = {
  id: number;
  ecode: string;
  name: string;
  startDate: Date;
  endDate: Date | null;
  /** Units still in inventory. */
  activeUnits: number;
};

export type Distribution<K> = Array<{ key: K; count: number }>;

/**
 * Lifecycle bucket of a unit in inventory. Seed lots and cultures have one of their own; `NONE`
 * groups plants or flowers that carry no growth stage (rare: the stage is carried forward).
 */
export type StageBucket = GrowthStage | "CULTURE" | "NONE";

export type InventorySnapshot = {
  total: number;
  byType: Distribution<UnitType>;
  byStage: Distribution<StageBucket>;
  /** Largest locations first, capped; `others` is what the cap left out. */
  byLocation: Array<{ id: number; name: string; count: number; capacity: number | null }>;
  otherLocations: { locations: number; units: number };
  /** Active units with no recorded location. */
  unlocated: number;
};

export type RecentEvent = {
  id: number;
  kind: UnitStateKind;
  recordedAt: Date;
  unitId: number;
  unitName: string;
  actorName: string;
  locationName: string | null;
};

export type RecentActivity =
  { kind: "audit"; entries: AuditEntryRow[] } | { kind: "events"; events: RecentEvent[] };

/** One laboratory member and the work they are part of (administrator view). */
export type MemberOverview = {
  id: number;
  name: string;
  permissions: Role;
  /** Experiments the member belongs to. */
  experiments: number;
  /** Units in inventory across those experiments. */
  units: number;
};

export type DashboardData = {
  view: DashboardView;
  inventory: InventorySnapshot;
  /** Units in inventory that carry an open hold. */
  onHold: number;
  /** Every unit the viewer may read, by status: the same counts as the units list. */
  statuses: UnitStatusCounts;
  runningExperiments: RunningExperiment[];
  runningExperimentCount: number;
  /** Active laboratory members; administrators only. */
  members: MemberOverview[] | null;
  recent: RecentActivity;
};

export const dashboardView = (user: SessionUser): DashboardView =>
  seesWholeLab(user) ? "admin" : "member";

/**
 * What a dashboard counts. Administrators see the whole laboratory; a member sees the units of the
 * experiments they belong to. This is the dashboard's own scope: other pages keep their read rules.
 */
export function dashboardUnitScope(user: SessionUser): Prisma.BiologicalUnitWhereInput {
  return seesWholeLab(user) ? {} : { experiment: { members: { some: { userId: user.id } } } };
}

function dashboardExperimentScope(user: SessionUser): Prisma.ExperimentWhereInput {
  return seesWholeLab(user) ? {} : { members: { some: { userId: user.id } } };
}

/**
 * Everything the dashboard shows. Counts, groupings and the newest-N lists are done by the
 * database; nothing loads a whole table.
 */
export async function getDashboard(user: SessionUser): Promise<DashboardData> {
  const scope = dashboardUnitScope(user);
  const running: Prisma.ExperimentWhereInput = {
    AND: [dashboardExperimentScope(user), { endDate: null }],
  };

  const [onHold, statuses, runningCount, runningList, inventory, members, recent] =
    await Promise.all([
      prisma.biologicalUnit.count({
        where: {
          AND: [scope, ACTIVE_UNIT_FILTER, { holds: { some: { releasedAt: null } } }],
        },
      }),
      getUnitStatusCounts(user, {}),
      prisma.experiment.count({ where: running }),
      prisma.experiment.findMany({
        where: running,
        orderBy: [{ startDate: "desc" }, { id: "desc" }],
        take: RUNNING_EXPERIMENTS_SHOWN,
        select: {
          id: true,
          ecode: true,
          name: true,
          startDate: true,
          endDate: true,
          _count: { select: { units: { where: ACTIVE_UNIT_FILTER } } },
        },
      }),
      getInventorySnapshot(user),
      seesWholeLab(user) ? getMemberOverview() : Promise.resolve(null),
      getRecentActivity(user),
    ]);

  return {
    view: dashboardView(user),
    inventory,
    onHold,
    statuses,
    runningExperiments: runningList.map((experiment) => ({
      id: experiment.id,
      ecode: experiment.ecode,
      name: experiment.name,
      startDate: experiment.startDate,
      endDate: experiment.endDate,
      activeUnits: experiment._count.units,
    })),
    runningExperimentCount: runningCount,
    members,
    recent,
  };
}

/** Units in inventory grouped by type, stage and location, aggregated by the database. */
export async function getInventorySnapshot(user: SessionUser): Promise<InventorySnapshot> {
  const scope = dashboardUnitScope(user);
  // One aggregate per type keeps the scope applicable (a raw query could not take it).
  const perType = await Promise.all(
    UNIT_TYPES.map(async (type) => ({
      type,
      groups: await prisma.unitState.groupBy({
        by: ["growthStage", "locationId"],
        where: {
          kind: { notIn: TERMINAL },
          currentOf: { is: { AND: [scope, { type }] } },
        },
        _count: { _all: true },
      }),
    }))
  );

  const byType = new Map<UnitType, number>();
  const byStage = new Map<StageBucket, number>();
  const byLocation = new Map<number, number>();
  let unlocated = 0;
  let total = 0;
  for (const { type, groups } of perType) {
    for (const group of groups) {
      const count = group._count._all;
      total += count;
      byType.set(type, (byType.get(type) ?? 0) + count);
      const stage = stageBucket(type, group.growthStage);
      byStage.set(stage, (byStage.get(stage) ?? 0) + count);
      if (group.locationId === null) unlocated += count;
      else byLocation.set(group.locationId, (byLocation.get(group.locationId) ?? 0) + count);
    }
  }

  const rankedLocations = [...byLocation.entries()].sort(
    ([idA, a], [idB, b]) => b - a || idA - idB
  );
  const shown = rankedLocations.slice(0, LOCATIONS_SHOWN);
  const rest = rankedLocations.slice(LOCATIONS_SHOWN);
  const names = await prisma.location.findMany({
    where: { id: { in: shown.map(([id]) => id) } },
    select: { id: true, name: true, capacity: true },
  });
  const locationOf = new Map(names.map((location) => [location.id, location]));

  return {
    total,
    byType: UNIT_TYPES.filter((type) => byType.has(type)).map((type) => ({
      key: type,
      count: byType.get(type) ?? 0,
    })),
    byStage: [...byStage.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    byLocation: shown.map(([id, count]) => ({
      id,
      name: locationOf.get(id)?.name ?? `#${id}`,
      count,
      capacity: locationOf.get(id)?.capacity ?? null,
    })),
    otherLocations: {
      locations: rest.length,
      units: rest.reduce((sum, [, count]) => sum + count, 0),
    },
    unlocated,
  };
}

export function stageBucket(type: UnitType, stage: GrowthStage | null): StageBucket {
  if (type === UnitType.SEEDLOT) return "SEED";
  if (type === UnitType.CULTURE) return "CULTURE";
  return stage ?? "NONE";
}

/**
 * Every active member with the experiments they belong to and the units in inventory across them,
 * in one grouped query. A unit shared by several members counts for each of them.
 */
async function getMemberOverview(): Promise<MemberOverview[]> {
  const [users, usage] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: MEMBERS_SHOWN,
      select: { id: true, name: true, permissions: true },
    }),
    prisma.$queryRaw<Array<{ userId: number; experiments: number; units: number }>>(Prisma.sql`
      SELECT m."userId" AS "userId",
             COUNT(DISTINCT m."experimentId")::int AS "experiments",
             COUNT(s."id")::int AS "units"
      FROM "ExperimentMember" m
      LEFT JOIN "BiologicalUnit" u ON u."experimentId" = m."experimentId"
      LEFT JOIN "UnitState" s ON s."id" = u."currentStateId"
        AND s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')
      GROUP BY m."userId"
    `),
  ]);
  const usageOf = new Map(usage.map((row) => [row.userId, row]));
  return users.map((member) => ({
    id: member.id,
    name: member.name,
    permissions: member.permissions,
    experiments: usageOf.get(member.id)?.experiments ?? 0,
    units: usageOf.get(member.id)?.units ?? 0,
  }));
}

/**
 * Those who read the audit trail (admins, quality assurance, inspectors) see its newest entries.
 * Everyone else sees the newest inventory events on the units they can see: the same facts, without
 * who-changed-what detail.
 */
async function getRecentActivity(user: SessionUser): Promise<RecentActivity> {
  if (canReadCompliance(user)) {
    return { kind: "audit", entries: await listRecentAuditEntries(user, RECENT_SHOWN) };
  }
  const states = await prisma.unitState.findMany({
    where: { unit: dashboardUnitScope(user) },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: RECENT_SHOWN,
    select: {
      id: true,
      kind: true,
      recordedAt: true,
      unit: { select: { id: true, name: true } },
      recordedBy: { select: { name: true } },
      location: { select: { name: true } },
    },
  });
  return {
    kind: "events",
    events: states.map((state) => ({
      id: state.id,
      kind: state.kind,
      recordedAt: state.recordedAt,
      unitId: state.unit.id,
      unitName: state.unit.name,
      actorName: state.recordedBy.name,
      locationName: state.location?.name ?? null,
    })),
  };
}
