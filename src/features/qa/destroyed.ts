import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Moisture, UnitType, WasteType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { parseDateRange, periodFilter } from "@/lib/reports/date-range";
import { likeEscape } from "@/lib/search-text";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";

export const DESTROYED_LIST_SORTS = ["date", "name", "type", "cultivar"] as const;
export type DestroyedListSort = (typeof DESTROYED_LIST_SORTS)[number];

export type DestroyedListParams = {
  q?: string;
  type?: UnitType;
  /** Calendar days (YYYY-MM-DD) in the laboratory time zone, both inclusive. */
  from?: string;
  to?: string;
  sort: DestroyedListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type DestroyedListRow = {
  id: number;
  name: string;
  type: UnitType;
  cultivarId: number | null;
  cultivarName: string | null;
  experiment: { id: number; ecode: string } | null;
  /** Where the unit last was. */
  locationId: number | null;
  locationName: string | null;
  /** When the destruction happened (the operator's date), and when it was filed. */
  destroyedAt: Date;
  recordedAt: Date;
  reason: string | null;
  comment: string | null;
  actor: string;
  actorId: number;
  witness: string | null;
  witnessId: number | null;
  /** The last weight on record, dry if there is one. */
  lastWeightGrams: number | null;
};

function orderByFor(
  sort: DestroyedListSort,
  order: "asc" | "desc"
): Prisma.BiologicalUnitOrderByWithRelationInput[] {
  const primary: Prisma.BiologicalUnitOrderByWithRelationInput =
    sort === "name"
      ? { name: order }
      : sort === "type"
        ? { type: order }
        : sort === "cultivar"
          ? { cultivar: { name: order } }
          : { currentState: { effectiveAt: order } };
  // A stable tie-break keeps pages from repeating or skipping rows.
  return [primary, { id: order }];
}

/** One page of the destruction register: units whose last event is a destruction. */
export async function listDestroyedUnits(
  user: SessionUser,
  params: DestroyedListParams
): Promise<{ rows: DestroyedListRow[]; total: number }> {
  const needle = params.q?.trim() ? likeEscape(params.q.trim()) : undefined;
  const range = periodFilter(parseDateRange(params.from, params.to));
  const where: Prisma.BiologicalUnitWhereInput = {
    AND: [
      unitReadScope(user),
      {
        currentState: {
          is: { kind: "DESTROYED", ...(range ? { effectiveAt: range } : {}) },
        },
      },
      params.type ? { type: params.type } : {},
      needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" } },
              { cultivar: { is: { name: { contains: needle, mode: "insensitive" } } } },
              { experiment: { is: { ecode: { contains: needle, mode: "insensitive" } } } },
              { experiment: { is: { name: { contains: needle, mode: "insensitive" } } } },
              {
                currentState: {
                  is: {
                    OR: [
                      { reason: { contains: needle, mode: "insensitive" } },
                      { comment: { contains: needle, mode: "insensitive" } },
                      { recordedBy: { is: { name: { contains: needle, mode: "insensitive" } } } },
                      { witness: { is: { name: { contains: needle, mode: "insensitive" } } } },
                      {
                        location: { is: { name: { contains: needle, mode: "insensitive" } } },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {},
    ],
  };

  const [total, units] = await Promise.all([
    prisma.biologicalUnit.count({ where }),
    prisma.biologicalUnit.findMany({
      where,
      orderBy: orderByFor(params.sort, params.order),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        name: true,
        type: true,
        cultivarId: true,
        cultivar: { select: { name: true } },
        experiment: { select: { id: true, ecode: true } },
        currentState: {
          select: {
            effectiveAt: true,
            recordedAt: true,
            reason: true,
            comment: true,
            dryWeight: true,
            humidWeight: true,
            locationId: true,
            recordedBy: { select: { id: true, name: true } },
            witness: { select: { id: true, name: true } },
            location: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const rows = units.flatMap((unit): DestroyedListRow[] => {
    const state = unit.currentState;
    if (!state) return [];
    const weight = state.dryWeight ?? state.humidWeight;
    return [
      {
        id: unit.id,
        name: unit.name,
        type: unit.type,
        cultivarId: unit.cultivarId,
        cultivarName: unit.cultivar?.name ?? null,
        experiment: unit.experiment,
        locationId: state.locationId,
        locationName: state.location?.name ?? null,
        destroyedAt: state.effectiveAt,
        recordedAt: state.recordedAt,
        reason: state.reason,
        comment: state.comment,
        actor: state.recordedBy.name,
        actorId: state.recordedBy.id,
        witness: state.witness?.name ?? null,
        witnessId: state.witness?.id ?? null,
        lastWeightGrams: weight === null ? null : Number(weight),
      },
    ];
  });
  return { rows, total };
}

export type WasteRow = {
  stateId: number;
  unitId: number;
  unitName: string;
  at: Date;
  type: WasteType | null;
  grams: number | null;
  moisture: Moisture | null;
  method: string | null;
  actor: string;
  actorId: number;
};

/** The most waste entries the register lists at once. */
export const WASTE_LIMIT = 200;

/**
 * Waste disposed of from units (trim, stems and leaves, roots…), newest first, within the register's
 * dates. Destroyed on the CTLS return, like the units above it.
 */
export async function listWasteEntries(
  user: SessionUser,
  range: { from?: string; to?: string }
): Promise<{ rows: WasteRow[]; total: number }> {
  const period = periodFilter(parseDateRange(range.from, range.to));
  const where: Prisma.UnitStateWhereInput = {
    kind: "WASTED",
    unit: unitReadScope(user),
    ...(period ? { effectiveAt: period } : {}),
  };
  const [states, total] = await Promise.all([
    prisma.unitState.findMany({
      where,
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      take: WASTE_LIMIT,
      select: {
        id: true,
        effectiveAt: true,
        wasteType: true,
        shippedWeight: true,
        shippedMoisture: true,
        reason: true,
        unit: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.unitState.count({ where }),
  ]);
  return {
    rows: states.map((s) => ({
      stateId: s.id,
      unitId: s.unit.id,
      unitName: s.unit.name,
      at: s.effectiveAt,
      type: s.wasteType,
      grams: s.shippedWeight === null ? null : Number(s.shippedWeight),
      moisture: s.shippedMoisture,
      method: s.reason,
      actor: s.recordedBy.name,
      actorId: s.recordedBy.id,
    })),
    total,
  };
}
