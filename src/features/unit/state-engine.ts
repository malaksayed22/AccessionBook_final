import "server-only";
import type { Prisma, UnitState } from "@/generated/prisma/client";
import { GrowthStage, UnitStateKind } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { errors } from "@/server/errors";
import type { WasteType } from "@/generated/prisma/enums";
import { getLabSettings } from "@/server/settings";

/**
 * The state engine: the only code that writes `UnitState` rows. Every unit event goes through
 * `appendState`, which runs inside the caller's transaction, holds a row lock on the unit, writes the
 * next immutable snapshot and moves the unit's `currentStateId` pointer. See docs/domain-model.md.
 */
export type Tx = Prisma.TransactionClient;

const loadArgs = {
  include: {
    currentState: true,
    holds: { where: { releasedAt: null } },
  },
} satisfies Prisma.BiologicalUnitDefaultArgs;

export type LoadedUnit = Prisma.BiologicalUnitGetPayload<typeof loadArgs>;

const TERMINAL_KINDS: ReadonlySet<UnitStateKind> = new Set([
  UnitStateKind.SHIPPED,
  UnitStateKind.DESTROYED,
]);

export function isTerminalKind(kind: UnitStateKind): boolean {
  return TERMINAL_KINDS.has(kind);
}

/**
 * Locks the unit row for the rest of the transaction and loads it with its current state and any
 * active hold. Two requests acting on the same unit are serialised here, so "destroy twice" or
 * "move while shipping" can never interleave.
 */
export async function lockUnit(tx: Tx, unitId: number): Promise<LoadedUnit> {
  const locked = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id" FROM "BiologicalUnit" WHERE "id" = ${unitId} FOR UPDATE`;
  if (locked.length === 0) throw errors.notFound("Unit");
  return tx.biologicalUnit.findUniqueOrThrow({ where: { id: unitId }, ...loadArgs });
}

export function currentStateOf(unit: LoadedUnit): UnitState {
  if (!unit.currentState) {
    throw errors.conflict(`Unit ${unit.name} has no recorded state`);
  }
  return unit.currentState;
}

export function isActive(unit: LoadedUnit): boolean {
  return unit.currentState !== null && !isTerminalKind(unit.currentState.kind);
}

export function assertActive(unit: LoadedUnit): UnitState {
  const state = currentStateOf(unit);
  if (isTerminalKind(state.kind)) {
    throw errors.unitNotActive(
      state.kind === UnitStateKind.DESTROYED
        ? "This unit has been destroyed and can no longer be changed"
        : "Everything of this unit has been shipped; nothing is left, so it can no longer be changed"
    );
  }
  return state;
}

export function isOnHold(unit: LoadedUnit): boolean {
  return unit.holds.length > 0;
}

export function assertNotOnHold(unit: LoadedUnit): void {
  if (isOnHold(unit)) throw errors.unitOnHold();
}

/** An event cannot be in the future, nor precede the unit's registration. */
/** Refuses a date further back than the laboratory's limit, when one is set (Settings). */
export async function assertWithinBackdateLimit(tx: Tx, effectiveAt: Date, now: Date) {
  const { backdateLimitDays } = await getLabSettings(tx);
  if (backdateLimitDays === null) return;
  if (now.getTime() - effectiveAt.getTime() > backdateLimitDays * 86_400_000) {
    throw errors.rule(
      "tooFarBack",
      `An event cannot be dated more than ${backdateLimitDays} days back`,
      { days: backdateLimitDays }
    );
  }
}

export async function assertEffectiveAt(
  tx: Tx,
  unitId: number,
  effectiveAt: Date,
  now: Date
): Promise<void> {
  if (effectiveAt.getTime() > now.getTime() + 1000) {
    throw errors.rule(
      "eventInFuture",
      "An event cannot be dated in the future — choose now or an earlier date"
    );
  }
  await assertWithinBackdateLimit(tx, effectiveAt, now);
  const first = await tx.unitState.findUnique({
    where: { unitId_sequence: { unitId, sequence: 1 } },
    select: { effectiveAt: true },
  });
  if (first && effectiveAt.getTime() < first.effectiveAt.getTime()) {
    const registered = first.effectiveAt.toISOString().slice(0, 10);
    throw errors.rule(
      "eventBeforeRegistration",
      `An event cannot be dated before the unit was registered (${registered})`,
      { registered }
    );
  }
}

/** A weight as a number, a decimal string, or the database's Decimal. */
export type DecimalInput = string | number | Prisma.Decimal;

/** Fields an event may change. `undefined` carries the previous value forward; `null` clears it. */
export type StatePatch = {
  locationId?: number | null;
  growthStage?: GrowthStage | null;
  humidWeight?: DecimalInput | null;
  dryWeight?: DecimalInput | null;
  seedCount?: number | null;
  /** A plant group's number of plants (null: one plant). */
  plantCount?: number | null;
  /** Event-specific fields below are never carried forward. */
  /** On a shipment: how much left (the snapshot columns above hold what is left after it). */
  shippedWeight?: DecimalInput | null;
  shippedMoisture?: "WET" | "DRY" | null;
  shippedCount?: number | null;
  organizationId?: number | null;
  scanConfirmed?: boolean;
  reason?: string | null;
  /** On WASTED: what was disposed of. */
  wasteType?: WasteType | null;
  witnessId?: number | null;
  comment?: string | null;
  parentStateId?: number | null;
};

function pick<K extends keyof StatePatch>(
  patch: StatePatch,
  key: K,
  previous: UnitState | null,
  previousKey: keyof UnitState
) {
  const value = patch[key];
  if (value !== undefined) return value;
  return previous ? previous[previousKey] : null;
}

type SnapshotFields = Pick<
  Prisma.UnitStateUncheckedCreateInput,
  "locationId" | "growthStage" | "humidWeight" | "dryWeight" | "seedCount" | "plantCount"
>;

/** Snapshot columns that persist from one event to the next. */
export function carryForward(previous: UnitState | null, patch: StatePatch): SnapshotFields {
  return {
    locationId: pick(patch, "locationId", previous, "locationId") as number | null,
    growthStage: pick(patch, "growthStage", previous, "growthStage") as GrowthStage | null,
    humidWeight: pick(patch, "humidWeight", previous, "humidWeight") as DecimalInput | null,
    dryWeight: pick(patch, "dryWeight", previous, "dryWeight") as DecimalInput | null,
    seedCount: pick(patch, "seedCount", previous, "seedCount") as number | null,
    plantCount: pick(patch, "plantCount", previous, "plantCount") as number | null,
  };
}

/**
 * Writes the unit's next event and repoints `currentStateId`. The caller must have obtained `unit`
 * from `lockUnit` in the same transaction and validated the business rules for this kind of event.
 */
export async function appendState(
  tx: Tx,
  actor: Pick<SessionUser, "id">,
  unit: Pick<LoadedUnit, "id" | "currentState">,
  kind: UnitStateKind,
  patch: StatePatch,
  effectiveAt: Date
): Promise<UnitState> {
  const previous = unit.currentState;
  const state = await tx.unitState.create({
    data: {
      unitId: unit.id,
      sequence: (previous?.sequence ?? 0) + 1,
      kind,
      effectiveAt,
      recordedById: actor.id,
      ...carryForward(previous, patch),
      shippedWeight: patch.shippedWeight ?? null,
      shippedMoisture: patch.shippedMoisture ?? null,
      shippedCount: patch.shippedCount ?? null,
      organizationId: patch.organizationId ?? null,
      scanConfirmed: patch.scanConfirmed ?? false,
      reason: patch.reason ?? null,
      wasteType: patch.wasteType ?? null,
      witnessId: patch.witnessId ?? null,
      comment: patch.comment ?? null,
      parentStateId: patch.parentStateId ?? null,
    },
  });
  await tx.biologicalUnit.update({ where: { id: unit.id }, data: { currentStateId: state.id } });
  return state;
}
