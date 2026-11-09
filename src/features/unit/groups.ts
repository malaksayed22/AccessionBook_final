import "server-only";
import { SourceType, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanEditUnit } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { MergeGroupInput, SplitGroupInput } from "./schemas";
import {
  assertCapacity,
  createUnitWithFirstState,
  nextFreeIndex,
  requireActiveLocation,
} from "./service";
import { appendState, assertActive, assertNotOnHold, lockUnit, type Tx } from "./state-engine";

/*
 * Plant groups: one plant unit can stand for many plants (a large grow), counted as a batch. A group
 * splits into a new group (some of its plants move on, perhaps to another room) or merges into
 * another group of the same experiment, cultivar and stage. The plants stay in inventory either way,
 * so the CTLS return books neither. A hold blocks both, as it blocks every custody change.
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

const plantsIn = (state: { plantCount: number | null }) => state.plantCount ?? 1;

async function lockPlantGroup(tx: Tx, actor: SessionUser, unitId: number) {
  const unit = await lockUnit(tx, unitId);
  await assertCanEditUnit(tx, actor, unit);
  const current = assertActive(unit);
  assertNotOnHold(unit);
  if (unit.type !== UnitType.PLANT) {
    throw errors.rule("groupNotPlants", "Only plant units are grouped, split or merged");
  }
  return { unit, current };
}

/** Moves `plants` plants of a group into a new group; the group keeps the rest. */
export async function splitGroup(
  actor: SessionUser,
  unitId: number,
  input: SplitGroupInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const { unit, current } = await lockPlantGroup(tx, actor, unitId);
    const plants = plantsIn(current);
    if (input.plants >= plants) {
      throw errors.rule("splitTooLarge", "A split leaves at least one plant in the group", {
        available: plants,
      });
    }
    if (!unit.experimentId) throw errors.validation("An experiment is required");
    const locationId = input.locationId ?? current.locationId;
    if (!locationId) throw errors.validation("A location is required");
    const location = await requireActiveLocation(tx, locationId);
    if (location.id !== current.locationId) {
      await assertCapacity(tx, location, { units: 1, plants: input.plants });
    }

    const now = new Date();
    const left = plants - input.plants;
    const regrouped = await appendState(
      tx,
      actor,
      unit,
      UnitStateKind.REGROUPED,
      { plantCount: left > 1 ? left : null, comment: input.comment },
      now
    );
    const prefix = `${unit.name}-G`;
    const name = `${prefix}-${await nextFreeIndex(tx, prefix)}`;
    const group = await createUnitWithFirstState(
      tx,
      actor,
      meta,
      {
        name,
        type: UnitType.PLANT,
        experimentId: unit.experimentId,
        cultivarId: unit.cultivarId ?? 0,
        locationId: location.id,
        sex: unit.sex,
        comment: input.comment ?? null,
        sourceType: SourceType.SPLIT,
        sourceDescription: `Split from ${unit.name}`,
        providerOrganizationId: null,
        sourceParentUnitId: unit.id,
        parentStateId: regrouped.id,
        growthStage: current.growthStage,
        seedCount: null,
        humidWeight: null,
        dryWeight: null,
        plantCount: input.plants > 1 ? input.plants : null,
      },
      now,
      {
        action: "split",
        summary: `Split ${input.plants} plants from ${unit.name} into ${name}`,
        changes: [{ field: "plants", from: null, to: String(input.plants) }],
      }
    );
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "split_parent",
      summary: `Split ${input.plants} plants into ${name}`,
      changes: [{ field: "plants", from: String(plants), to: String(left) }],
    });
    return { group: { id: group.id, name: group.name }, left };
  }, TRANSACTION);
}

/**
 * The whole group joins `intoUnitId`: same experiment, cultivar and growth stage. The target counts
 * the plants from now on; the merged group is kept on record with nothing left.
 */
export async function mergeGroup(
  actor: SessionUser,
  unitId: number,
  input: MergeGroupInput,
  meta?: RequestMeta
) {
  if (input.intoUnitId === unitId) {
    throw errors.rule("mergeIntoItself", "A group cannot merge into itself");
  }
  return prisma.$transaction(async (tx) => {
    // Lock in id order so two merges cannot deadlock on each other.
    const [firstId, secondId] = [unitId, input.intoUnitId].sort((a, b) => a - b);
    const first = await lockPlantGroup(tx, actor, firstId!);
    const second = await lockPlantGroup(tx, actor, secondId!);
    const source = first.unit.id === unitId ? first : second;
    const target = first.unit.id === unitId ? second : first;

    const alike =
      source.unit.experimentId === target.unit.experimentId &&
      source.unit.cultivarId === target.unit.cultivarId &&
      source.current.growthStage === target.current.growthStage;
    if (!alike) {
      throw errors.rule(
        "mergeNotAlike",
        "Only groups of the same experiment, cultivar and growth stage can merge"
      );
    }

    const now = new Date();
    const moved = plantsIn(source.current);
    const total = plantsIn(target.current) + moved;
    const joined = await appendState(
      tx,
      actor,
      target.unit,
      UnitStateKind.REGROUPED,
      { plantCount: total, comment: `Joined by ${source.unit.name}` },
      now
    );
    await appendState(
      tx,
      actor,
      source.unit,
      UnitStateKind.MERGED,
      {
        comment: input.comment ?? `Merged into ${target.unit.name}`,
        parentStateId: joined.id,
      },
      now
    );
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: source.unit.id,
      entityLabel: source.unit.name,
      action: "merge",
      summary: `Merged ${moved} plants into ${target.unit.name}`,
    });
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: target.unit.id,
      entityLabel: target.unit.name,
      action: "merge_target",
      summary: `Joined by ${source.unit.name} (${moved} plants)`,
      changes: [{ field: "plants", from: String(total - moved), to: String(total) }],
    });
    return { into: { id: target.unit.id, name: target.unit.name }, plants: total };
  }, TRANSACTION);
}

/** Groups this group could merge into: active plant units of the same experiment, cultivar and stage. */
export async function listMergeTargets(actor: SessionUser, unitId: number, q: string) {
  const unit = await prisma.biologicalUnit.findUnique({
    where: { id: unitId },
    include: { currentState: true },
  });
  if (!unit || unit.type !== UnitType.PLANT || !unit.currentState) return [];
  // Only offer groups the person may change (the same experiment's); the service checks again.
  try {
    await assertCanEditUnit(prisma, actor, unit);
  } catch {
    return [];
  }
  const rows = await prisma.biologicalUnit.findMany({
    where: {
      id: { not: unit.id },
      type: UnitType.PLANT,
      experimentId: unit.experimentId,
      cultivarId: unit.cultivarId,
      name: { contains: q.trim(), mode: "insensitive" },
      holds: { none: { releasedAt: null } },
      currentState: {
        is: {
          growthStage: unit.currentState.growthStage,
          kind: { notIn: ["SHIPPED", "DESTROYED", "MERGED"] },
        },
      },
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, currentState: { select: { plantCount: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    plants: row.currentState?.plantCount ?? 1,
  }));
}
