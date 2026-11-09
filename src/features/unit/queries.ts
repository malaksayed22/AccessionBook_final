import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { GrowthStage, UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { suggestedKindForUnitType } from "@/lib/experiment-intake";
import { likeEscape } from "@/lib/search-text";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import { EMPTIED_KINDS, isEmptied, NO_STOCK_KINDS } from "@/lib/stock-kinds";

/** What the "new experiment from this unit" form pre-fills from a source unit. */
export async function getIntakeContext(unitId: number) {
  const unit = await prisma.biologicalUnit.findUnique({
    where: { id: unitId },
    include: {
      cultivar: { select: { id: true, name: true } },
      providerOrganization: { select: { id: true, name: true } },
      currentState: { include: { location: { select: { id: true, name: true } } } },
    },
  });
  if (!unit) throw errors.notFound("Unit");

  const providerMode = unit.providerOrganizationId ? "EXTERNAL" : "INTERNAL";
  const state = unit.currentState;
  return {
    id: unit.id,
    name: unit.name,
    type: unit.type,
    cultivarId: unit.cultivarId,
    cultivarName: unit.cultivar?.name ?? null,
    locationId: state?.locationId ?? null,
    locationName: state?.location?.name ?? null,
    growthStage: state?.growthStage ?? null,
    providerOrganizationId: unit.providerOrganizationId,
    providerOrganizationName: unit.providerOrganization?.name ?? null,
    providerMode,
    sourceDescription:
      unit.sourceDescription ||
      (providerMode === "INTERNAL" ? `Internal stock derived from ${unit.name}` : null),
    suggestedKind: suggestedKindForUnitType(unit.type),
  };
}

// --- Unit list ------------------------------------------------------------------------------------

/**
 * Every unit is in exactly one of these. "empty" is a unit whose stock was all shipped: still active on
 * record (shipping is not a status), but nothing is left, so it is never counted as active stock.
 */
export const UNIT_LIST_STATUSES = ["active", "hold", "empty", "destroyed"] as const;
export type UnitListStatus = (typeof UNIT_LIST_STATUSES)[number];
export const UNIT_LIST_STAGES = [
  "VEGETATIVE",
  "FLOWERING",
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
  "SEED",
] as const satisfies readonly GrowthStage[];
export const UNIT_LIST_SORTS = ["date", "name", "type", "cultivar", "location"] as const;
export type UnitListSort = (typeof UNIT_LIST_SORTS)[number];
/** What the list can group its rows by: the rows come sorted by it first. */
export const UNIT_LIST_GROUPS = ["type", "cultivar", "experiment", "location"] as const;
export type UnitListGroup = (typeof UNIT_LIST_GROUPS)[number];

export type UnitListParams = {
  q?: string;
  type?: UnitType;
  status?: UnitListStatus;
  stage?: (typeof UNIT_LIST_STAGES)[number];
  locationId?: number;
  /** Only these units (rows chosen on the page, for an export). */
  ids?: readonly number[];
  group?: UnitListGroup;
  sort: UnitListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type UnitListRow = {
  id: number;
  /** Short code made by the database (U-0001). */
  code: string;
  name: string;
  type: UnitType;
  cultivarId: number | null;
  cultivarName: string | null;
  experiment: { id: number; ecode: string } | null;
  locationId: number | null;
  locationName: string | null;
  /** The growth stage now (plants and flowers). */
  growthStage: string | null;
  lastUpdated: Date;
  status: "active" | "on-hold" | "destroyed";
  /** Everything was shipped: still active on record, with nothing left in stock. */
  nothingLeft: boolean;
  /** What is in stock now: grams for flower (null = never weighed), seeds for a seed lot. */
  left: { wetGrams: number | null; dryGrams: number | null; seeds: number | null };
};

function statusWhere(status: UnitListStatus | undefined): Prisma.BiologicalUnitWhereInput {
  switch (status) {
    case "active":
      // Active stock: not on hold, not destroyed, and something left (the same definition as the
      // dashboard, locations and the CTLS return). A unit that shipped in part is still active.
      return {
        currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } },
        holds: { none: { releasedAt: null } },
      };
    case "empty":
      return {
        currentState: { is: { kind: { in: [...EMPTIED_KINDS] } } },
        holds: { none: { releasedAt: null } },
      };
    case "destroyed":
      return { currentState: { is: { kind: "DESTROYED" } } };
    case "hold":
      return {
        currentState: { is: { kind: { not: "DESTROYED" } } },
        holds: { some: { releasedAt: null } },
      };
    default:
      return {};
  }
}

const GROUP_ORDER: Record<UnitListGroup, Prisma.BiologicalUnitOrderByWithRelationInput> = {
  type: { type: "asc" },
  cultivar: { cultivar: { name: "asc" } },
  experiment: { experiment: { ecode: "asc" } },
  location: { currentState: { location: { name: "asc" } } },
};

function orderByFor(
  sort: UnitListSort,
  order: "asc" | "desc",
  group?: UnitListGroup
): Prisma.BiologicalUnitOrderByWithRelationInput[] {
  const primary: Prisma.BiologicalUnitOrderByWithRelationInput =
    sort === "name"
      ? { name: order }
      : sort === "type"
        ? { type: order }
        : sort === "cultivar"
          ? { cultivar: { name: order } }
          : sort === "location"
            ? { currentState: { location: { name: order } } }
            : { currentState: { recordedAt: order } };
  // A stable tie-break keeps pages from repeating or skipping rows.
  return [...(group ? [GROUP_ORDER[group]] : []), primary, { id: order }];
}

/** Everything a list filter narrows by except the status, so the status counts can share it. */
function filterWhere(
  user: SessionUser,
  params: Omit<UnitListParams, "sort" | "order" | "page" | "limit" | "status">
): Prisma.BiologicalUnitWhereInput {
  const needle = params.q?.trim() ? likeEscape(params.q.trim()) : undefined;
  return {
    AND: [
      unitReadScope(user),
      params.ids ? { id: { in: [...params.ids] } } : {},
      params.type ? { type: params.type } : {},
      params.stage ? { currentState: { is: { growthStage: params.stage } } } : {},
      params.locationId ? { currentState: { is: { locationId: params.locationId } } } : {},
      needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" } },
              { code: { contains: needle, mode: "insensitive" } },
              { cultivar: { is: { name: { contains: needle, mode: "insensitive" } } } },
              { experiment: { is: { name: { contains: needle, mode: "insensitive" } } } },
              { experiment: { is: { ecode: { contains: needle, mode: "insensitive" } } } },
              {
                currentState: {
                  is: { location: { is: { name: { contains: needle, mode: "insensitive" } } } },
                },
              },
            ],
          }
        : {},
    ],
  };
}

/** Every unit has exactly one status, so these counts add up to all units. */
export type UnitStatusCounts = Record<UnitListStatus, number>;

/**
 * How many units are in each status, for the cards above the list. Every filter except the status
 * itself applies, so a card shows what choosing it would list.
 */
export async function getUnitStatusCounts(
  user: SessionUser,
  params: Omit<UnitListParams, "sort" | "order" | "page" | "limit" | "status">
): Promise<UnitStatusCounts> {
  const base = filterWhere(user, params);
  const count = (status: UnitListStatus) =>
    prisma.biologicalUnit.count({ where: { AND: [base, statusWhere(status)] } });
  const [active, hold, empty, destroyed] = await Promise.all([
    count("active"),
    count("hold"),
    count("empty"),
    count("destroyed"),
  ]);
  return { active, hold, empty, destroyed };
}

const grams = (value: { toString(): string } | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

/** One page of units with filters, search and sort applied by the database. */
export async function listUnits(
  user: SessionUser,
  params: UnitListParams
): Promise<{ rows: UnitListRow[]; total: number }> {
  const where: Prisma.BiologicalUnitWhereInput = {
    AND: [filterWhere(user, params), statusWhere(params.status)],
  };

  const [total, units] = await Promise.all([
    prisma.biologicalUnit.count({ where }),
    prisma.biologicalUnit.findMany({
      where,
      orderBy: orderByFor(params.sort, params.order, params.group),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        createdAt: true,
        cultivarId: true,
        cultivar: { select: { name: true } },
        experiment: { select: { id: true, ecode: true } },
        currentState: {
          select: {
            kind: true,
            recordedAt: true,
            locationId: true,
            growthStage: true,
            humidWeight: true,
            dryWeight: true,
            seedCount: true,
            location: { select: { name: true } },
          },
        },
        holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
      },
    }),
  ]);

  const rows = units.map((unit): UnitListRow => {
    const kind = unit.currentState?.kind;
    const hold = unit.holds[0]?.kind;
    return {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      type: unit.type,
      cultivarId: unit.cultivarId,
      cultivarName: unit.cultivar?.name ?? null,
      experiment: unit.experiment,
      locationId: unit.currentState?.locationId ?? null,
      locationName: unit.currentState?.location?.name ?? null,
      growthStage: unit.currentState?.growthStage ?? null,
      lastUpdated: unit.currentState?.recordedAt ?? unit.createdAt,
      status: kind === "DESTROYED" ? "destroyed" : hold ? "on-hold" : "active",
      nothingLeft: isEmptied(kind),
      left: {
        wetGrams: grams(unit.currentState?.humidWeight),
        dryGrams: grams(unit.currentState?.dryWeight),
        seeds: unit.currentState?.seedCount ?? null,
      },
    };
  });
  return { rows, total };
}

/** Active locations for a filter, plus the currently selected one even if it was retired. */
export async function listLocationOptions(selectedId?: number) {
  return prisma.location.findMany({
    where: selectedId ? { OR: [{ active: true }, { id: selectedId }] } : { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

// --- Unit detail -----------------------------------------------------------------------------------
// Profile, ledger, quality, documents and the choices for the action forms live in
// `detail-queries.ts`; they are exported from here so callers have one place to import reads from.
export * from "./detail-queries";

/** The unit's name for the browser tab title, or null when it is absent or not readable. */
export async function getUnitName(user: SessionUser, id: number): Promise<string | null> {
  const unit = await prisma.biologicalUnit.findFirst({
    where: { AND: [unitReadScope(user), { id }] },
    select: { name: true },
  });
  return unit?.name ?? null;
}
