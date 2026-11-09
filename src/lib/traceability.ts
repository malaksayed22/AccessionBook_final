import type { UnitType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

export type UnitRef = { id: number; name: string; type: UnitType };

export type MotherLineage = {
  /** Immediate parent this unit was cut/subcultured from. */
  parent: UnitRef | null;
  /** Root of the lineage: the original mother plant. */
  mother: UnitRef | null;
  /** Full path from mother down to (but excluding) this unit. */
  ancestry: UnitRef[];
  /** How many propagation steps separate this unit from the mother. */
  generation: number;
};

/** Deepest propagation chain followed when walking up from a unit (guards against corrupted loops). */
export const MAX_LINEAGE_DEPTH = 50;

/** Builds the lineage summary from the ancestors ordered mother first. */
export function buildMotherLineage(ancestry: UnitRef[]): MotherLineage {
  return {
    parent: ancestry[ancestry.length - 1] ?? null,
    mother: ancestry[0] ?? null,
    ancestry,
    generation: ancestry.length,
  };
}

/**
 * Walks `sourceParentUnitId` to the root of the propagation chain, unscoped. Kept for the recall
 * trace (`lib/recall.ts`); the unit page uses the user-scoped walk in `features/unit/queries.ts`.
 * Depth is capped and visited ids tracked so a corrupted (cyclic) record cannot hang the request.
 */
export async function getMotherLineage(unitId: number): Promise<MotherLineage> {
  const ancestry: UnitRef[] = [];
  const seen = new Set<number>([unitId]);
  const start = await prisma.biologicalUnit.findUnique({
    where: { id: unitId },
    select: { sourceParentUnitId: true },
  });
  let nextId = start?.sourceParentUnitId ?? null;
  while (nextId && !seen.has(nextId) && ancestry.length < MAX_LINEAGE_DEPTH) {
    seen.add(nextId);
    const parent: (UnitRef & { sourceParentUnitId: number | null }) | null =
      await prisma.biologicalUnit.findUnique({
        where: { id: nextId },
        select: { id: true, name: true, type: true, sourceParentUnitId: true },
      });
    if (!parent) break;
    ancestry.unshift({ id: parent.id, name: parent.name, type: parent.type });
    nextId = parent.sourceParentUnitId;
  }
  return buildMotherLineage(ancestry);
}

// -----------------------------------------------------------------------------
// Location history (derived from the unit's MOVED events)
// -----------------------------------------------------------------------------

export type LocationStay = {
  locationId: number | null;
  locationName: string;
  from: Date;
  to: Date | null;
  days: number;
  current: boolean;
  movedBy: string | null;
  scanConfirmed: boolean;
  comment: string | null;
};

export type LocationHistory = {
  stays: LocationStay[];
  current: LocationStay | null;
  distinctLocations: number;
  totalMoves: number;
};

/** The slice of a `UnitState` (with its location and recorder) that location history needs. */
export type LocatedState = {
  sequence: number;
  kind: string;
  effectiveAt: Date;
  scanConfirmed: boolean;
  comment: string | null;
  locationId: number | null;
  location: { id: number; name: string } | null;
  recordedBy: { name: string } | null;
};

export type UnitMove<T extends LocatedState = LocatedState> = {
  state: T;
  fromLocation: { id: number; name: string } | null;
  toLocation: { id: number; name: string };
};

const MS_PER_DAY = 86_400_000;
const TERMINAL_KINDS = new Set(["SHIPPED", "DESTROYED", "MERGED"]);

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
}

function bySequence<T extends { sequence: number }>(states: readonly T[]): T[] {
  return [...states].sort((a, b) => a.sequence - b.sequence);
}

/** `MOVED` events, oldest first; the origin is the location carried by the previous event. */
export function deriveMoves<T extends LocatedState>(states: readonly T[]): UnitMove<T>[] {
  const moves: UnitMove<T>[] = [];
  let previous: T | null = null;
  for (const state of bySequence(states)) {
    if (state.kind === "MOVED" && state.location) {
      moves.push({ state, fromLocation: previous?.location ?? null, toLocation: state.location });
    }
    previous = state;
  }
  return moves;
}

/**
 * Every room a unit has occupied, in order. A stay starts with the event that placed the unit in
 * the room (CREATED, RECEIVED or MOVED) and ends with the next change of room — or, once the unit
 * has been shipped or destroyed, with that event. The last stay is always the "current" one, the
 * room the unit is (or was last) in.
 */
export function buildLocationHistory(
  states: readonly LocatedState[],
  now: Date = new Date()
): LocationHistory {
  const ordered = bySequence(states);
  const stays: LocationStay[] = [];
  let open: LocationStay | null = null;
  let totalMoves = 0;

  const close = (stay: LocationStay, at: Date) => {
    stay.to = at;
    stay.days = daysBetween(stay.from, at);
  };

  for (const state of ordered) {
    if (state.kind === "MOVED") totalMoves += 1;
    const isTerminal = TERMINAL_KINDS.has(state.kind);
    if (isTerminal) {
      if (open) close(open, state.effectiveAt);
      continue;
    }
    if (state.locationId === (open?.locationId ?? null)) continue;

    if (open) close(open, state.effectiveAt);
    if (!state.location) {
      open = null;
      continue;
    }
    open = {
      locationId: state.location.id,
      locationName: state.location.name,
      from: state.effectiveAt,
      to: null,
      days: 0,
      current: false,
      movedBy: state.kind === "MOVED" ? (state.recordedBy?.name ?? null) : null,
      scanConfirmed: state.kind === "MOVED" && state.scanConfirmed,
      comment: state.kind === "MOVED" ? state.comment : null,
    };
    stays.push(open);
  }

  const last = stays[stays.length - 1];
  if (last) {
    last.current = true;
    if (!last.to) last.days = daysBetween(last.from, now);
  }

  return {
    stays,
    current: last ?? null,
    distinctLocations: new Set(stays.map((s) => s.locationId)).size,
    totalMoves,
  };
}
