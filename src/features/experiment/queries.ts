import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  ExperimentRole,
  IncidentStatus,
  ShipmentStatus,
  SourceType,
  UnitType,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { buildStageSpans, stageBucketOf, type StageSpan } from "@/lib/experiment-progress";
import { getLocationOccupancy } from "@/lib/lab";
import { zonedDateKey } from "@/lib/lab-time";
import { likeEscape } from "@/lib/search-text";
import { canEditExperiment, experimentReadScope, isAdmin, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { getIntakeContext } from "@/features/unit/queries";
import { experimentStatusOf, type ExperimentStatus } from "./dates";
import { EMPTIED_KINDS, isEmptied, NO_STOCK_KINDS } from "@/lib/stock-kinds";

// --- Shared pieces --------------------------------------------------------------------------------

/** Units that are still active (not destroyed), with or without stock left: shipping is not a status. */
const IN_INVENTORY: Prisma.BiologicalUnitWhereInput = {
  currentState: { is: { kind: { not: "DESTROYED" } } },
};
/** Units that still hold stock (something is left to label, store or ship). */
const IN_STOCK: Prisma.BiologicalUnitWhereInput = {
  currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } },
};
const OPEN_HOLD: Prisma.BiologicalUnitWhereInput = { holds: { some: { releasedAt: null } } };
const NO_OPEN_HOLD: Prisma.BiologicalUnitWhereInput = { holds: { none: { releasedAt: null } } };
/** Everything was shipped and nothing holds the unit: the units list's "Nothing left". */
const NOTHING_LEFT: Prisma.BiologicalUnitWhereInput = {
  AND: [{ currentState: { is: { kind: { in: [...EMPTIED_KINDS] } } } }, NO_OPEN_HOLD],
};

export type ExperimentMemberView = { userId: number; name: string; role: ExperimentRole };

function sortMembers(
  members: Array<{ role: ExperimentRole; user: { id: number; name: string } }>
): ExperimentMemberView[] {
  return members
    .map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role }))
    .sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name) : a.role === "LEAD" ? -1 : 1
    );
}

export type UnitStatusView = "active" | "on-hold" | "destroyed";

function unitStatusOf(kind: string | undefined, hold: "HOLD" | undefined): UnitStatusView {
  if (kind === "DESTROYED") return "destroyed";
  return hold ? "on-hold" : "active";
}

// --- Experiment list ------------------------------------------------------------------------------

export const EXPERIMENT_LIST_STATUSES = ["running", "completed"] as const;
export type ExperimentListStatus = (typeof EXPERIMENT_LIST_STATUSES)[number];
export const EXPERIMENT_LIST_SORTS = ["date", "end", "name", "code", "units"] as const;
export type ExperimentListSort = (typeof EXPERIMENT_LIST_SORTS)[number];

export type ExperimentListParams = {
  q?: string;
  status?: ExperimentListStatus;
  /** Only experiments the signed-in member belongs to. */
  mine?: boolean;
  sort: ExperimentListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type ExperimentStats = {
  /** Units that are not destroyed: active, on hold or with nothing left. */
  inventory: number;
  /** In stock and not on hold, the one definition of "Active" (as in the units list). */
  active: number;
  /** Of the units not destroyed, those on hold. */
  onHold: number;
  /** Fully shipped and not on hold. */
  nothingLeft: number;
  destroyed: number;
  types: Array<{ type: UnitType; count: number }>;
  /** When each lifecycle stage started and ended, and how many days it took. */
  timeline: StageSpan[];
  locations: Array<{ id: number; name: string; count: number }>;
};

export type ExperimentListRow = {
  id: number;
  ecode: string;
  name: string;
  comment: string | null;
  startDate: Date;
  endDate: Date | null;
  status: ExperimentStatus;
  unitCount: number;
  members: ExperimentMemberView[];
  parent: { id: number; ecode: string } | null;
  mine: boolean;
  stats: ExperimentStats;
  /** Optional estimate of when the experiment will be completed. */
  estimatedEndDate: Date | null;
};

function statusWhere(status: ExperimentListStatus | undefined): Prisma.ExperimentWhereInput {
  switch (status) {
    case "running":
      return { endDate: null };
    case "completed":
      return { endDate: { not: null } };
    default:
      return {};
  }
}

function experimentOrderBy(
  sort: ExperimentListSort,
  order: "asc" | "desc"
): Prisma.ExperimentOrderByWithRelationInput[] {
  const primary: Prisma.ExperimentOrderByWithRelationInput =
    sort === "name"
      ? { name: order }
      : sort === "code"
        ? { ecode: order }
        : sort === "units"
          ? { units: { _count: order } }
          : sort === "end"
            ? { endDate: { sort: order, nulls: "last" } }
            : { startDate: order };
  // A stable tie-break keeps pages from repeating or skipping rows.
  return [primary, { id: order }];
}

function emptyStats(): ExperimentStats {
  return {
    inventory: 0,
    active: 0,
    onHold: 0,
    nothingLeft: 0,
    destroyed: 0,
    types: [],
    timeline: [],
    locations: [],
  };
}

type TimelineRow = {
  experimentId: number;
  stage: ReturnType<typeof stageBucketOf>;
  started: Date;
  ended: Date | null;
};

/**
 * When each unit of the given experiments entered and left each lifecycle stage, folded to one row
 * per experiment and stage by the database. A unit is in a stage from the first event that carries it
 * until its next stage, or until it is shipped or destroyed; a stage with a unit still in it has no end.
 */
async function loadTimelineRows(ids: number[]): Promise<TimelineRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<
    Array<{
      experimentId: number;
      type: UnitType;
      stage: string | null;
      started: Date;
      ended: Date | null;
      ongoing: boolean;
    }>
  >`
    WITH ordered AS (
      SELECT u."experimentId" AS eid, u."id" AS uid, u."type" AS type, st."sequence" AS seq,
             st."kind" AS kind, st."growthStage"::text AS stage, st."effectiveAt" AS at,
             LEAD(st."effectiveAt") OVER w AS next_at
      FROM "BiologicalUnit" u
      JOIN "UnitState" st ON st."unitId" = u."id"
      WHERE u."experimentId" IN (${Prisma.join(ids)})
      WINDOW w AS (PARTITION BY u."id" ORDER BY st."sequence")
    ), marked AS (
      SELECT *, CASE WHEN COALESCE(stage, '') IS DISTINCT FROM
                          COALESCE(LAG(stage) OVER (PARTITION BY uid ORDER BY seq), '#')
                     THEN 1 ELSE 0 END AS new_run
      FROM ordered
    ), runs AS (
      SELECT *, SUM(new_run) OVER (PARTITION BY uid ORDER BY seq) AS run FROM marked
    ), per_unit AS (
      SELECT eid, uid, run, type, stage, MIN(at) AS started,
             CASE WHEN BOOL_OR(kind IN ('SHIPPED', 'DESTROYED', 'MERGED'))
                  THEN MAX(at) FILTER (WHERE kind IN ('SHIPPED', 'DESTROYED', 'MERGED'))
                  ELSE (ARRAY_AGG(next_at ORDER BY seq DESC))[1] END AS ended
      FROM runs
      GROUP BY eid, uid, run, type, stage
    )
    SELECT eid AS "experimentId", type, stage, MIN(started) AS started,
           MAX(ended) AS ended, BOOL_OR(ended IS NULL) AS ongoing
    FROM per_unit
    GROUP BY eid, type, stage`;
  return rows.map((row) => ({
    experimentId: row.experimentId,
    stage: stageBucketOf(row.type, row.stage),
    started: row.started,
    ended: row.ongoing ? null : row.ended,
  }));
}

/** Unit counts for a page of experiments: six aggregate queries, whatever the page size. */
/**
 * A completion date is a calendar day stored as midnight UTC. Stage dates are instants shown in the
 * lab's time zone, so the day is anchored at noon to land on the same calendar day there.
 */
const anchorDay = (day: Date | null) => (day ? new Date(day.getTime() + 12 * 3_600_000) : null);

async function loadStats(
  user: SessionUser,
  ids: number[],
  completedOn: ReadonlyMap<number, Date | null>
): Promise<Map<number, ExperimentStats>> {
  const stats = new Map(ids.map((id) => [id, emptyStats()]));
  if (ids.length === 0) return stats;

  const scoped = (extra: Prisma.BiologicalUnitWhereInput): Prisma.BiologicalUnitWhereInput => ({
    AND: [unitReadScope(user), { experimentId: { in: ids } }, extra],
  });

  const [inventoryByType, held, emptied, destroyed, locations, timelineRows] = await Promise.all([
    prisma.biologicalUnit.groupBy({
      by: ["experimentId", "type"],
      where: scoped(IN_INVENTORY),
      _count: { _all: true },
    }),
    prisma.biologicalUnit.groupBy({
      by: ["experimentId"],
      where: scoped({ AND: [IN_INVENTORY, OPEN_HOLD] }),
      _count: { _all: true },
    }),
    prisma.biologicalUnit.groupBy({
      by: ["experimentId"],
      where: scoped(NOTHING_LEFT),
      _count: { _all: true },
    }),
    prisma.biologicalUnit.groupBy({
      by: ["experimentId"],
      where: scoped({ currentState: { is: { kind: "DESTROYED" } } }),
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ experimentId: number; id: number; name: string; units: bigint }>>`
      SELECT u."experimentId" AS "experimentId", l."id" AS "id", l."name" AS "name", count(*) AS "units"
      FROM "BiologicalUnit" u
      JOIN "UnitState" s ON s."id" = u."currentStateId"
      JOIN "Location" l ON l."id" = s."locationId"
      WHERE u."experimentId" IN (${Prisma.join(ids)})
        AND s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')
      GROUP BY u."experimentId", l."id", l."name"
      ORDER BY count(*) DESC, l."name" ASC`,
    loadTimelineRows(ids),
  ]);

  for (const row of inventoryByType) {
    const entry = row.experimentId === null ? undefined : stats.get(row.experimentId);
    if (!entry) continue;
    entry.inventory += row._count._all;
    entry.types.push({ type: row.type, count: row._count._all });
  }
  for (const row of held) {
    const entry = row.experimentId === null ? undefined : stats.get(row.experimentId);
    if (entry) entry.onHold = row._count._all;
  }
  for (const row of emptied) {
    const entry = row.experimentId === null ? undefined : stats.get(row.experimentId);
    if (entry) entry.nothingLeft = row._count._all;
  }
  for (const row of destroyed) {
    const entry = row.experimentId === null ? undefined : stats.get(row.experimentId);
    if (entry) entry.destroyed = row._count._all;
  }
  for (const row of locations) {
    stats
      .get(row.experimentId)
      ?.locations.push({ id: row.id, name: row.name, count: Number(row.units) });
  }
  const now = new Date();
  const byExperiment = new Map<number, TimelineRow[]>();
  for (const row of timelineRows) {
    const list = byExperiment.get(row.experimentId) ?? [];
    list.push(row);
    byExperiment.set(row.experimentId, list);
  }
  for (const [id, entry] of stats) {
    // The units not destroyed are on hold, nothing left or active, and nothing else.
    entry.active = entry.inventory - entry.onHold - entry.nothingLeft;
    entry.types.sort((a, b) => b.count - a.count);
    entry.timeline = buildStageSpans(byExperiment.get(id) ?? [], now, completedOn.get(id) ?? null);
  }
  return stats;
}

/** One page of experiments with search, status, membership filter and sort applied by the database. */
export async function listExperiments(
  user: SessionUser,
  params: ExperimentListParams
): Promise<{ rows: ExperimentListRow[]; total: number }> {
  const needle = params.q?.trim() ? likeEscape(params.q.trim()) : undefined;
  const where: Prisma.ExperimentWhereInput = {
    AND: [
      experimentReadScope(user),
      statusWhere(params.status),
      params.mine ? { members: { some: { userId: user.id } } } : {},
      needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" } },
              { ecode: { contains: needle, mode: "insensitive" } },
              { comment: { contains: needle, mode: "insensitive" } },
              {
                members: {
                  some: { user: { is: { name: { contains: needle, mode: "insensitive" } } } },
                },
              },
            ],
          }
        : {},
    ],
  };

  const [total, experiments] = await Promise.all([
    prisma.experiment.count({ where }),
    prisma.experiment.findMany({
      where,
      orderBy: experimentOrderBy(params.sort, params.order),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        ecode: true,
        name: true,
        comment: true,
        startDate: true,
        endDate: true,
        estimatedEndDate: true,
        parentExperiment: { select: { id: true, ecode: true } },
        members: { select: { role: true, user: { select: { id: true, name: true } } } },
        _count: { select: { units: true } },
      },
    }),
  ]);

  const stats = await loadStats(
    user,
    experiments.map((e) => e.id),
    new Map(experiments.map((e) => [e.id, anchorDay(e.endDate)]))
  );
  const rows = experiments.map((experiment): ExperimentListRow => {
    const members = sortMembers(experiment.members);
    const entry = stats.get(experiment.id) ?? emptyStats();
    return {
      id: experiment.id,
      ecode: experiment.ecode,
      name: experiment.name,
      comment: experiment.comment,
      startDate: experiment.startDate,
      endDate: experiment.endDate,
      status: experimentStatusOf(experiment.endDate),
      unitCount: experiment._count.units,
      members,
      parent: experiment.parentExperiment,
      mine: members.some((m) => m.userId === user.id),
      estimatedEndDate: experiment.estimatedEndDate,
      stats: entry,
    };
  });
  return { rows, total };
}

// --- Experiment detail ----------------------------------------------------------------------------

export type ExperimentUnitRow = {
  id: number;
  name: string;
  type: UnitType;
  cultivarId: number | null;
  cultivarName: string | null;
  locationId: number | null;
  locationName: string | null;
  growthStage: string | null;
  lastUpdated: Date;
  status: UnitStatusView;
  nothingLeft: boolean;
};

export const EXPERIMENT_UNIT_STATUSES = ["active", "hold", "empty", "destroyed"] as const;
export type ExperimentUnitStatus = (typeof EXPERIMENT_UNIT_STATUSES)[number];
export const EXPERIMENT_UNIT_SORTS = ["name", "type", "cultivar", "location", "date"] as const;
export type ExperimentUnitSort = (typeof EXPERIMENT_UNIT_SORTS)[number];

export type ExperimentUnitParams = {
  status?: ExperimentUnitStatus;
  sort: ExperimentUnitSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

function unitStatusWhere(
  status: ExperimentUnitStatus | undefined
): Prisma.BiologicalUnitWhereInput {
  switch (status) {
    // The same statuses as the units list.
    case "active":
      return { AND: [IN_STOCK, NO_OPEN_HOLD] };
    case "empty":
      return NOTHING_LEFT;
    case "destroyed":
      return { currentState: { is: { kind: "DESTROYED" } } };
    case "hold":
      return { AND: [IN_INVENTORY, OPEN_HOLD] };
    default:
      return {};
  }
}

function unitOrderBy(
  sort: ExperimentUnitSort,
  order: "asc" | "desc"
): Prisma.BiologicalUnitOrderByWithRelationInput[] {
  const primary: Prisma.BiologicalUnitOrderByWithRelationInput =
    sort === "type"
      ? { type: order }
      : sort === "cultivar"
        ? { cultivar: { name: order } }
        : sort === "location"
          ? { currentState: { location: { name: order } } }
          : sort === "date"
            ? { currentState: { recordedAt: order } }
            : { name: order };
  return [primary, { id: order }];
}

/** One page of an experiment's units, filtered, sorted and paged by the database. */
export async function listExperimentUnits(
  user: SessionUser,
  experimentId: number,
  params: ExperimentUnitParams
): Promise<{ rows: ExperimentUnitRow[]; total: number }> {
  const where: Prisma.BiologicalUnitWhereInput = {
    AND: [unitReadScope(user), { experimentId }, unitStatusWhere(params.status)],
  };
  const [total, units] = await Promise.all([
    prisma.biologicalUnit.count({ where }),
    prisma.biologicalUnit.findMany({
      where,
      orderBy: unitOrderBy(params.sort, params.order),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        name: true,
        type: true,
        createdAt: true,
        cultivarId: true,
        cultivar: { select: { name: true } },
        currentState: {
          select: {
            kind: true,
            recordedAt: true,
            locationId: true,
            growthStage: true,
            location: { select: { name: true } },
          },
        },
        holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
      },
    }),
  ]);
  return {
    total,
    rows: units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      type: unit.type,
      cultivarId: unit.cultivarId,
      cultivarName: unit.cultivar?.name ?? null,
      locationId: unit.currentState?.locationId ?? null,
      locationName: unit.currentState?.location?.name ?? null,
      growthStage: unit.currentState?.growthStage ?? null,
      lastUpdated: unit.currentState?.recordedAt ?? unit.createdAt,
      status: unitStatusOf(unit.currentState?.kind, unit.holds[0]?.kind),
      nothingLeft: isEmptied(unit.currentState?.kind),
    })),
  };
}

export type ExperimentUnitGroup = {
  type: UnitType;
  cultivarId: number | null;
  cultivarName: string | null;
  total: number;
  inventory: number;
};

export type ExperimentProvenanceRow = {
  sourceType: SourceType | null;
  provider: { id: number; name: string } | null;
  description: string | null;
  units: number;
};

export type ExperimentReceipt = {
  id: number;
  reference: string;
  status: ShipmentStatus;
  deliveredDate: Date | null;
  organization: { id: number; name: string };
  /** Lines of this receipt that belong to this experiment. */
  lines: number;
};

export type ExperimentAuditEntry = {
  id: number;
  at: Date;
  userId: number | null;
  userName: string;
  action: string;
  summary: string;
};

export type ExperimentDocumentRow = {
  id: number;
  label: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: Date;
  userId: number;
  userName: string;
  /** The member who attached it or an administrator. */
  canRemove: boolean;
};

export type ExperimentDetail = {
  id: number;
  ecode: string;
  name: string;
  comment: string | null;
  startDate: Date;
  endDate: Date | null;
  createdAt: Date;
  status: ExperimentStatus;
  parent: { id: number; ecode: string; name: string } | null;
  children: Array<{ id: number; ecode: string; name: string; status: ExperimentStatus }>;
  sourceUnit: { id: number; name: string } | null;
  members: ExperimentMemberView[];
  /** Active users who could still be added; only filled for administrators. */
  availableUsers: Array<{ id: number; name: string }>;
  /** Admin or member of the experiment: whether to offer edit actions (the server enforces it). */
  canEdit: boolean;
  /** Only administrators assign and remove members. */
  canManageMembers: boolean;
  /** Who-changed-what entries are administrators' business, as on the activity page. */
  canViewAudit: boolean;
  /** `inventory`: not destroyed. `active`: in stock and not on hold, as in the units list. */
  counts: {
    total: number;
    inventory: number;
    active: number;
    onHold: number;
    nothingLeft: number;
    destroyed: number;
  };
  /** Units still on hand by type, and when each lifecycle stage started and ended. */
  types: Array<{ type: UnitType; count: number }>;
  timeline: StageSpan[];
  estimatedEndDate: Date | null;
  documents: ExperimentDocumentRow[];
  groups: ExperimentUnitGroup[];
  locations: Array<{ id: number; name: string; count: number }>;
  provenance: ExperimentProvenanceRow[];
  receipts: ExperimentReceipt[];
  activity: {
    recent: ExperimentAuditEntry[];
    unitEvents: number;
    lastUnitEventAt: Date | null;
    fieldRecords: number;
    openIncidents: number;
  };
};

const OPEN_INCIDENT: IncidentStatus[] = ["OPEN", "INVESTIGATING"];

/** Everything the experiment's record page shows, except the paged unit table. Null if it does not exist. */
export async function getExperimentDetail(
  user: SessionUser,
  id: number
): Promise<ExperimentDetail | null> {
  const experiment = await prisma.experiment.findFirst({
    where: { AND: [experimentReadScope(user), { id }] },
    select: {
      id: true,
      ecode: true,
      name: true,
      comment: true,
      startDate: true,
      endDate: true,
      estimatedEndDate: true,
      createdAt: true,
      parentExperiment: { select: { id: true, ecode: true, name: true } },
      subExperiments: {
        orderBy: { startDate: "desc" },
        take: 50,
        select: { id: true, ecode: true, name: true, endDate: true },
      },
      sourceUnit: { select: { id: true, name: true } },
      members: { select: { role: true, user: { select: { id: true, name: true } } } },
    },
  });
  if (!experiment) return null;

  const base: Prisma.BiologicalUnitWhereInput = {
    AND: [unitReadScope(user), { experimentId: id }],
  };
  const admin = isAdmin(user);
  const memberIds = experiment.members.map((m) => m.user.id);

  const [
    canEdit,
    availableUsers,
    total,
    inventory,
    onHold,
    nothingLeft,
    destroyed,
    groupTotals,
    groupInventory,
    locations,
    provenanceRows,
    receipts,
    recent,
    unitEvents,
    fieldRecords,
    openIncidents,
    timelineRows,
    documentRows,
  ] = await Promise.all([
    canEditExperiment(prisma, user, id),
    admin
      ? prisma.user.findMany({
          where: { active: true, id: { notIn: memberIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.biologicalUnit.count({ where: base }),
    prisma.biologicalUnit.count({ where: { AND: [base, IN_INVENTORY] } }),
    prisma.biologicalUnit.count({ where: { AND: [base, IN_INVENTORY, OPEN_HOLD] } }),
    prisma.biologicalUnit.count({ where: { AND: [base, NOTHING_LEFT] } }),
    prisma.biologicalUnit.count({
      where: { AND: [base, { currentState: { is: { kind: "DESTROYED" } } }] },
    }),
    prisma.biologicalUnit.groupBy({
      by: ["type", "cultivarId"],
      where: base,
      _count: { _all: true },
    }),
    prisma.biologicalUnit.groupBy({
      by: ["type", "cultivarId"],
      where: { AND: [base, IN_INVENTORY] },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ id: number; name: string; units: bigint }>>`
      SELECT l."id" AS "id", l."name" AS "name", count(*) AS "units"
      FROM "BiologicalUnit" u
      JOIN "UnitState" s ON s."id" = u."currentStateId"
      JOIN "Location" l ON l."id" = s."locationId"
      WHERE u."experimentId" = ${id} AND s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')
      GROUP BY l."id", l."name"
      ORDER BY count(*) DESC, l."name" ASC`,
    prisma.biologicalUnit.groupBy({
      by: ["sourceType", "providerOrganizationId", "sourceDescription"],
      where: base,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prisma.shipment.findMany({
      where: {
        direction: "INBOUND",
        voidedAt: null,
        items: { some: { unit: { is: { experimentId: id } } } },
      },
      orderBy: [{ deliveredDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        reference: true,
        status: true,
        deliveredDate: true,
        organization: { select: { id: true, name: true } },
        _count: { select: { items: { where: { unit: { is: { experimentId: id } } } } } },
      },
    }),
    admin
      ? prisma.auditLog.findMany({
          where: { entityType: "experiment", entityId: id },
          orderBy: { seq: "desc" },
          take: 8,
          select: {
            id: true,
            createdAt: true,
            userId: true,
            userName: true,
            action: true,
            summary: true,
          },
        })
      : Promise.resolve([]),
    prisma.unitState.aggregate({
      where: { unit: { is: { experimentId: id } } },
      _count: { _all: true },
      _max: { recordedAt: true },
    }),
    prisma.unitActivity.count({ where: { unit: { is: { experimentId: id } } } }),
    prisma.qualityIncident.count({
      where: { experimentId: id, voidedAt: null, status: { in: OPEN_INCIDENT } },
    }),
    loadTimelineRows([id]),
    prisma.experimentAttachment.findMany({
      where: { experimentId: id, voidedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        fileName: true,
        sizeBytes: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    }),
  ]);

  const cultivarIds = [
    ...new Set(groupTotals.flatMap((g) => (g.cultivarId === null ? [] : [g.cultivarId]))),
  ];
  const providerIds = [
    ...new Set(
      provenanceRows.flatMap((p) =>
        p.providerOrganizationId === null ? [] : [p.providerOrganizationId]
      )
    ),
  ];
  const [cultivars, providers] = await Promise.all([
    cultivarIds.length
      ? prisma.cultivar.findMany({
          where: { id: { in: cultivarIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    providerIds.length
      ? prisma.organization.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const cultivarName = new Map(cultivars.map((c) => [c.id, c.name]));
  const providerById = new Map(providers.map((p) => [p.id, p]));
  const inventoryOf = new Map(
    groupInventory.map((g) => [`${g.type}:${g.cultivarId ?? ""}`, g._count._all])
  );

  const groups = groupTotals
    .map((g): ExperimentUnitGroup => ({
      type: g.type,
      cultivarId: g.cultivarId,
      cultivarName: g.cultivarId === null ? null : (cultivarName.get(g.cultivarId) ?? null),
      total: g._count._all,
      inventory: inventoryOf.get(`${g.type}:${g.cultivarId ?? ""}`) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        (a.cultivarName ?? "").localeCompare(b.cultivarName ?? "") ||
        a.type.localeCompare(b.type)
    );

  const typeCounts = new Map<UnitType, number>();
  for (const g of groupInventory) {
    typeCounts.set(g.type, (typeCounts.get(g.type) ?? 0) + g._count._all);
  }

  return {
    id: experiment.id,
    ecode: experiment.ecode,
    name: experiment.name,
    comment: experiment.comment,
    startDate: experiment.startDate,
    endDate: experiment.endDate,
    createdAt: experiment.createdAt,
    status: experimentStatusOf(experiment.endDate),
    parent: experiment.parentExperiment,
    children: experiment.subExperiments.map((child) => ({
      id: child.id,
      ecode: child.ecode,
      name: child.name,
      status: experimentStatusOf(child.endDate),
    })),
    sourceUnit: experiment.sourceUnit,
    members: sortMembers(experiment.members),
    availableUsers,
    canEdit,
    canManageMembers: admin,
    canViewAudit: admin,
    counts: {
      total,
      inventory,
      active: inventory - onHold - nothingLeft,
      onHold,
      nothingLeft,
      destroyed,
    },
    types: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    timeline: buildStageSpans(timelineRows, new Date(), anchorDay(experiment.endDate)),
    estimatedEndDate: experiment.estimatedEndDate,
    documents: documentRows.map((row) => ({
      id: row.id,
      label: row.label,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
      userId: row.user.id,
      userName: row.user.name,
      canRemove: admin || row.user.id === user.id,
    })),
    groups,
    locations: locations.map((l) => ({ id: l.id, name: l.name, count: Number(l.units) })),
    provenance: provenanceRows.map((row) => ({
      sourceType: row.sourceType,
      provider:
        row.providerOrganizationId === null
          ? null
          : (providerById.get(row.providerOrganizationId) ?? null),
      description: row.sourceDescription,
      units: row._count._all,
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      deliveredDate: r.deliveredDate,
      organization: r.organization,
      lines: r._count.items,
    })),
    activity: {
      recent: recent.map((entry) => ({
        id: entry.id,
        at: entry.createdAt,
        userId: entry.userId,
        userName: entry.userName,
        action: entry.action,
        summary: entry.summary,
      })),
      unitEvents: unitEvents._count._all,
      lastUnitEventAt: unitEvents._max.recordedAt,
      fieldRecords,
      openIncidents,
    },
  };
}

// --- Labels ---------------------------------------------------------------------------------------

export const MAX_LABEL_UNITS = 500;

export type ExperimentLabelData = {
  experiment: { id: number; ecode: string; name: string };
  /** Public address of the application: label QR codes carry absolute profile links. */
  baseUrl: string;
  units: Array<{ unitId: number; name: string; type: UnitType; cultivarName: string | null }>;
  /** Units in inventory beyond the ones listed. */
  omitted: number;
};

/** The units of an experiment that are still in inventory, for printing their barcode labels. */
export async function getExperimentLabels(
  user: SessionUser,
  id: number
): Promise<ExperimentLabelData | null> {
  const experiment = await prisma.experiment.findFirst({
    where: { AND: [experimentReadScope(user), { id }] },
    select: { id: true, ecode: true, name: true },
  });
  if (!experiment) return null;
  const where: Prisma.BiologicalUnitWhereInput = {
    AND: [unitReadScope(user), { experimentId: id }, IN_STOCK],
  };
  const [count, units] = await Promise.all([
    prisma.biologicalUnit.count({ where }),
    prisma.biologicalUnit.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: MAX_LABEL_UNITS,
      select: { id: true, name: true, type: true, cultivar: { select: { name: true } } },
    }),
  ]);
  return {
    experiment,
    baseUrl: env().APP_URL,
    units: units.map((u) => ({
      unitId: u.id,
      name: u.name,
      type: u.type,
      cultivarName: u.cultivar?.name ?? null,
    })),
    omitted: Math.max(0, count - units.length),
  };
}

// --- New experiment wizard ------------------------------------------------------------------------

export type WizardOptions = {
  user: { id: number; name: string; admin: boolean };
  /** Today in the laboratory's time zone (`YYYY-MM-DD`): the default start date. */
  today: string;
  cultivars: Array<{ id: number; name: string }>;
  locations: Array<{ id: number; name: string; capacity: number | null; occupancy: number }>;
  organizations: Array<{ id: number; name: string }>;
  /** Other active members who can be added to the team (administrators only). */
  users: Array<{ id: number; name: string }>;
  /** Experiments the member may attach a sub-experiment to. */
  parentOptions: Array<{ id: number; ecode: string; name: string }>;
  parent: { id: number; ecode: string; name: string } | null;
  parentProblem: "missing" | "forbidden" | null;
  /** Prefill taken from the unit a sub-experiment starts from. */
  sourceUnit: Awaited<ReturnType<typeof getIntakeContext>> | null;
};

/** Everything the new-experiment wizard needs to fill its pickers, in one round trip. */
export async function getExperimentWizardOptions(
  user: SessionUser,
  request: { parentId?: number; sourceUnitId?: number } = {}
): Promise<WizardOptions> {
  const admin = isAdmin(user);
  const [cultivars, locationRows, organizations, users, parentOptions, occupancy] =
    await Promise.all([
      prisma.cultivar.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.location.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, capacity: true },
      }),
      prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      admin
        ? prisma.user.findMany({
            where: { active: true, id: { not: user.id } },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      prisma.experiment.findMany({
        where: experimentReadScope(user),
        orderBy: [{ startDate: "desc" }, { id: "desc" }],
        select: { id: true, ecode: true, name: true },
      }),
      getLocationOccupancy(),
    ]);

  let parent: WizardOptions["parent"] = null;
  let parentProblem: WizardOptions["parentProblem"] = null;
  if (request.parentId) {
    const found = await prisma.experiment.findUnique({
      where: { id: request.parentId },
      select: { id: true, ecode: true, name: true },
    });
    if (!found) parentProblem = "missing";
    else if (!(await canEditExperiment(prisma, user, found.id))) parentProblem = "forbidden";
    else parent = found;
  }

  let sourceUnit: WizardOptions["sourceUnit"] = null;
  if (request.sourceUnitId) {
    sourceUnit = await getIntakeContext(request.sourceUnitId).catch(() => null);
  }

  return {
    user: { id: user.id, name: user.name, admin },
    today: zonedDateKey(new Date(), env().LAB_TIMEZONE),
    cultivars,
    locations: locationRows.map((l) => ({
      id: l.id,
      name: l.name,
      capacity: l.capacity,
      occupancy: occupancy.get(l.id) ?? 0,
    })),
    organizations,
    users,
    parentOptions:
      parent && !parentOptions.some((p) => p.id === parent.id)
        ? [parent, ...parentOptions]
        : parentOptions,
    parent,
    parentProblem,
    sourceUnit,
  };
}

/** The experiment's code for the browser tab title, or null when it is absent or not readable. */
export async function getExperimentCode(user: SessionUser, id: number): Promise<string | null> {
  const experiment = await prisma.experiment.findFirst({
    where: { AND: [experimentReadScope(user), { id }] },
    select: { ecode: true },
  });
  return experiment?.ecode ?? null;
}

export type ExperimentLogEntry = {
  id: number;
  at: Date;
  userId: number | null;
  userName: string;
  entityType: string;
  entityId: number;
  entityLabel: string;
  action: string;
  summary: string;
};

/**
 * The experiment's own log: every audited change to the experiment, its units and its tasks, newest
 * first, one page at a time. Administrators only, like the activity on the experiment page (null
 * otherwise, or when the experiment is not readable).
 */
export async function getExperimentLog(
  user: SessionUser,
  id: number,
  page: number,
  limit: number
): Promise<{
  experiment: { id: number; ecode: string; name: string };
  rows: ExperimentLogEntry[];
  total: number;
} | null> {
  if (!isAdmin(user)) return null;
  const experiment = await prisma.experiment.findFirst({
    where: { AND: [experimentReadScope(user), { id }] },
    select: { id: true, ecode: true, name: true },
  });
  if (!experiment) return null;

  const [units, tasks] = await Promise.all([
    prisma.biologicalUnit.findMany({ where: { experimentId: id }, select: { id: true } }),
    prisma.task.findMany({ where: { experimentId: id }, select: { id: true } }),
  ]);
  const where: Prisma.AuditLogWhereInput = {
    OR: [
      { entityType: "experiment", entityId: id },
      { entityType: "unit", entityId: { in: units.map((u) => u.id) } },
      { entityType: "task", entityId: { in: tasks.map((t) => t.id) } },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { seq: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        createdAt: true,
        userId: true,
        userName: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        action: true,
        summary: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    experiment,
    rows: rows.map(({ createdAt, ...row }) => ({ ...row, at: createdAt })),
    total,
  };
}
