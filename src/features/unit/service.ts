import "server-only";
import type { UnitState } from "@/generated/prisma/client";
import {
  GrowthStage,
  SourceType,
  UnitStateKind,
  UnitType,
  type SampleKind,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { resolveEffectiveAt } from "@/lib/lab-time";
import {
  assessLocationCapacity,
  countedGrams,
  type CapacityMeasure,
  type Incoming,
} from "@/lib/location-capacity";
import { validateProvenance } from "@/lib/provenance";
import { isLaterStage } from "@/lib/stage-order";
import { getUnitBarcodeValue } from "@/lib/unit-codes";
import { buildChanges, recordAudit, type AuditEntry, type RequestMeta } from "@/server/audit";
import {
  assertCanAnnotateDestroyedUnit,
  assertCanCreateUnit,
  assertCanEditExperiment,
  assertAdmin,
  assertCanEditUnit,
  isAdmin,
} from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import type {
  ChangeStageInput,
  DeriveUnitInput,
  DestroyUnitInput,
  LinkParentInput,
  MeasureUnitInput,
  MoveUnitInput,
  RegisterUnitInput,
  UpdateUnitDetailsInput,
} from "./schemas";
import {
  appendState,
  assertActive,
  assertEffectiveAt,
  assertNotOnHold,
  assertWithinBackdateLimit,
  isTerminalKind,
  lockUnit,
  type Tx,
} from "./state-engine";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";

/**
 * Unit commands. Each is one database transaction: authorization, rule checks, the immutable state
 * event, the pointer move and the audit entry commit together or not at all. Nothing here trusts the
 * client for anything that matters (identity, dates in the future, who may act).
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;
const MAX_LINEAGE_DEPTH = 200;

type Actor = SessionUser;

const audit = recordAudit;

function resolveDate(input: string | undefined, now: Date): Date {
  if (input === undefined) return now;
  const resolved = resolveEffectiveAt(input, now, env().LAB_TIMEZONE);
  if (!resolved) throw errors.validation("The date is not valid");
  return resolved;
}

/**
 * What a location holds now: its units in inventory, every plant of its plant units (`PLANTS`), or
 * the grams of its weighed material (`WEIGHT`), dry weight once recorded, else wet.
 */
async function occupancyOf(
  tx: Tx,
  locationId: number,
  measure: CapacityMeasure = "UNITS"
): Promise<number> {
  if (measure === "WEIGHT") {
    const rows = await tx.$queryRaw<Array<{ grams: number }>>`
      SELECT COALESCE(SUM(COALESCE(s."dryWeight", s."humidWeight", 0)), 0)::float8 AS "grams"
      FROM "BiologicalUnit" u
      JOIN "UnitState" s ON s."id" = u."currentStateId"
      WHERE s."locationId" = ${locationId}
        AND s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')`;
    return rows[0]?.grams ?? 0;
  }
  if (measure === "PLANTS") {
    const rows = await tx.$queryRaw<Array<{ plants: number }>>`
      SELECT COALESCE(SUM(COALESCE(s."plantCount", 1)), 0)::int AS "plants"
      FROM "BiologicalUnit" u
      JOIN "UnitState" s ON s."id" = u."currentStateId"
      WHERE s."locationId" = ${locationId} AND u."type" = 'PLANT'
        AND s."kind" NOT IN ('SHIPPED', 'DESTROYED', 'MERGED')`;
    return rows[0]?.plants ?? 0;
  }
  return tx.biologicalUnit.count({
    where: {
      currentState: {
        is: {
          locationId,
          kind: { notIn: [...NO_STOCK_KINDS] },
        },
      },
    },
  });
}

/**
 * Refuses what would overfill a location. `incoming` is units, or every measure; a location that
 * counts plants takes the plants (a non-plant unit brings none), one that counts weight takes the
 * grams. Recording a weight on a unit already there is never refused: the weight is a fact, and the
 * locations page shows the room over capacity.
 */
export async function assertCapacity(
  tx: Tx,
  location: {
    id: number;
    name: string;
    capacity: number | null;
    capacityMeasure?: CapacityMeasure;
  },
  incoming: number | Incoming
) {
  const result = assessLocationCapacity(
    {
      ...location,
      occupancy: await occupancyOf(tx, location.id, location.capacityMeasure ?? "UNITS"),
    },
    incoming
  );
  if (!result.ok) throw errors.conflict(result.message ?? "Location capacity exceeded");
}

export async function requireActiveLocation(tx: Tx, locationId: number) {
  // A shared row lock pairs with retireLocation's exclusive lock: a unit cannot be placed in a location
  // at the same moment it is being retired (one of the two waits for the other and then re-checks).
  await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${locationId} FOR SHARE`;
  const location = await tx.location.findUnique({ where: { id: locationId } });
  if (!location) throw errors.notFound("Location");
  if (!location.active) throw errors.locationInactive(location.name);
  return location;
}

/** First free `<base>-<n>` for names that must be unique (case-insensitively). */
export async function nextFreeIndex(tx: Tx, base: string): Promise<number> {
  const existing = await tx.biologicalUnit.findMany({
    where: { name: { startsWith: `${base}-`, mode: "insensitive" } },
    select: { name: true },
  });
  const taken = new Set(existing.map((u) => u.name.toLowerCase()));
  let n = 1;
  while (taken.has(`${base}-${n}`.toLowerCase())) n += 1;
  return n;
}

async function assertNameFree(tx: Tx, name: string) {
  const clash = await tx.biologicalUnit.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { name: true },
  });
  if (clash) throw errors.conflict(`A unit named "${clash.name}" already exists`);
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

type NewUnit = {
  name: string;
  type: UnitType;
  experimentId: number;
  cultivarId: number;
  locationId: number;
  sex: string | null;
  comment: string | null;
  sourceType: SourceType;
  sourceDescription: string | null;
  providerOrganizationId: number | null;
  sourceParentUnitId: number | null;
  parentStateId: number | null;
  growthStage: GrowthStage | null;
  seedCount: number | null;
  humidWeight: number | null;
  dryWeight: number | null;
  /** Plants in a plant group; null for one plant (and every other type). */
  plantCount?: number | null;
  /** Set when the new unit is a sample of `sourceParentUnitId`. */
  sampleKind?: SampleKind | null;
};

/** Creates a unit and its first event. Used by registration, derivation and samples. */
export async function createUnitWithFirstState(
  tx: Tx,
  actor: Actor,
  meta: RequestMeta | undefined,
  data: NewUnit,
  effectiveAt: Date,
  auditEntry: Pick<AuditEntry, "action" | "summary" | "changes">
) {
  await assertNameFree(tx, data.name);
  const unit = await tx.biologicalUnit.create({
    data: {
      name: data.name,
      type: data.type,
      experimentId: data.experimentId,
      cultivarId: data.cultivarId,
      sex: data.sex,
      comment: data.comment,
      sourceType: data.sourceType,
      sourceDescription: data.sourceDescription,
      providerOrganizationId: data.providerOrganizationId,
      sourceParentUnitId: data.sourceParentUnitId,
      sampleKind: data.sampleKind ?? null,
    },
  });
  const state = await appendState(
    tx,
    actor,
    { id: unit.id, currentState: null },
    data.providerOrganizationId ? UnitStateKind.RECEIVED : UnitStateKind.CREATED,
    {
      locationId: data.locationId,
      growthStage: data.growthStage,
      humidWeight: data.humidWeight,
      dryWeight: data.dryWeight,
      seedCount: data.seedCount,
      plantCount: data.plantCount ?? null,
      organizationId: data.providerOrganizationId,
      parentStateId: data.parentStateId,
      comment: data.sourceDescription,
    },
    effectiveAt
  );
  await audit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    ...auditEntry,
  });
  return { id: unit.id, name: unit.name, stateId: state.id };
}

function initialStage(type: UnitType, requested: GrowthStage | undefined): GrowthStage | null {
  if (type === UnitType.PLANT) return requested ?? GrowthStage.VEGETATIVE;
  if (type === UnitType.FLOWER) return requested ?? GrowthStage.HARVESTED;
  return null;
}

export async function registerUnits(actor: Actor, input: RegisterUnitInput, meta?: RequestMeta) {
  const provenanceError = validateProvenance({
    sourceType: input.sourceType,
    sourceDescription: input.sourceDescription,
    providerOrganizationId: input.providerOrganizationId,
  });
  if (provenanceError) throw errors.validation(provenanceError);

  const now = new Date();
  const effectiveAt = resolveDate(input.effectiveAt, now);
  await assertWithinBackdateLimit(prisma, effectiveAt, now);
  if (effectiveAt.getTime() > now.getTime() + 1000) {
    throw errors.rule(
      "registrationInFuture",
      "A unit cannot be registered with a date in the future"
    );
  }

  return prisma.$transaction(async (tx) => {
    await assertCanCreateUnit(tx, actor, input.experimentId);

    const [experiment, cultivar, provider, parent] = await Promise.all([
      tx.experiment.findUnique({ where: { id: input.experimentId }, select: { id: true } }),
      tx.cultivar.findUnique({ where: { id: input.cultivarId }, select: { id: true, name: true } }),
      input.providerOrganizationId
        ? tx.organization.findUnique({ where: { id: input.providerOrganizationId } })
        : null,
      input.sourceParentUnitId
        ? tx.biologicalUnit.findUnique({
            where: { id: input.sourceParentUnitId },
            select: { id: true, name: true, currentStateId: true },
          })
        : null,
    ]);
    if (!experiment) throw errors.notFound("Experiment");
    if (!cultivar) throw errors.notFound("Cultivar");
    if (input.providerOrganizationId && !provider) throw errors.notFound("Provider organization");
    if (input.sourceParentUnitId && !parent) throw errors.notFound("Parent unit");

    // Harvested material is reported to Health Canada by weight: it is weighed when it is registered.
    if (input.type === UnitType.FLOWER && input.humidWeight == null && input.dryWeight == null) {
      throw errors.rule(
        "flowerWeightRequired",
        "Enter the wet or dry weight of the harvested flower when you register it"
      );
    }

    const location = await requireActiveLocation(tx, input.locationId);
    const weighed = input.type === UnitType.PLANT || input.type === UnitType.FLOWER;
    await assertCapacity(tx, location, {
      units: input.quantity,
      plants: input.type === UnitType.PLANT ? input.quantity * (input.plantCount ?? 1) : 0,
      grams: weighed ? input.quantity * countedGrams(input) : 0,
    });

    const units: Array<{ id: number; name: string }> = [];
    for (let i = 1; i <= input.quantity; i += 1) {
      const name = input.quantity === 1 ? input.name : `${input.name}-${i}`;
      units.push(
        await createUnitWithFirstState(
          tx,
          actor,
          meta,
          {
            name,
            type: input.type,
            experimentId: input.experimentId,
            cultivarId: input.cultivarId,
            locationId: location.id,
            sex: input.sex ?? null,
            comment: input.comment ?? null,
            sourceType: input.sourceType,
            sourceDescription: input.sourceDescription ?? null,
            providerOrganizationId: input.providerOrganizationId ?? null,
            sourceParentUnitId: parent?.id ?? null,
            parentStateId: parent?.currentStateId ?? null,
            growthStage: initialStage(input.type, input.growthStage),
            seedCount: input.type === UnitType.SEEDLOT ? (input.seedCount ?? null) : null,
            plantCount:
              input.type === UnitType.PLANT && (input.plantCount ?? 1) > 1
                ? (input.plantCount ?? null)
                : null,
            humidWeight: weighed ? (input.humidWeight ?? null) : null,
            dryWeight: weighed ? (input.dryWeight ?? null) : null,
          },
          effectiveAt,
          {
            action: "create",
            summary: `Registered ${input.type.toLowerCase()} ${name} (${cultivar.name}) at ${location.name}`,
            changes: [
              { field: "location", from: null, to: location.name },
              { field: "source", from: null, to: input.sourceType },
            ],
          }
        )
      );
    }
    return { units };
  }, TRANSACTION);
}

// -----------------------------------------------------------------------------
// Derivation (clone, cutting, subculture): the parent is never consumed
// -----------------------------------------------------------------------------

const DERIVED_SOURCE: Record<DeriveUnitInput["deriveType"], SourceType> = {
  clone: SourceType.CLONE,
  cutting: SourceType.CUTTING,
  subculture: SourceType.SUBCULTURE,
};

export async function deriveUnits(
  actor: Actor,
  parentUnitId: number,
  input: DeriveUnitInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(
    (tx) => deriveUnitsTx(tx, actor, parentUnitId, input, meta),
    TRANSACTION
  );
}

/** Same as deriveUnits, inside a caller-owned transaction (so a new experiment can commit with it). */
export async function deriveUnitsTx(
  tx: Tx,
  actor: Actor,
  parentUnitId: number,
  input: DeriveUnitInput,
  meta?: RequestMeta
) {
  const now = new Date();

  {
    const parent = await lockUnit(tx, parentUnitId);
    await assertCanEditUnit(tx, actor, parent);
    const parentState = assertActive(parent);
    assertNotOnHold(parent);

    const childType = input.deriveType === "subculture" ? UnitType.CULTURE : UnitType.PLANT;
    const parentOk =
      input.deriveType === "subculture"
        ? parent.type === UnitType.PLANT || parent.type === UnitType.CULTURE
        : parent.type === UnitType.PLANT;
    if (!parentOk) {
      throw errors.validation(
        input.deriveType === "subculture"
          ? "Subcultures can only be derived from a plant or a culture"
          : "Clones and cuttings can only be derived from a plant"
      );
    }

    const experimentId = input.experimentId ?? parent.experimentId;
    if (!experimentId) throw errors.validation("An experiment is required");
    await assertCanEditExperiment(tx, actor, experimentId);

    const locationId = input.locationId ?? parentState.locationId;
    if (!locationId) throw errors.validation("A location is required");
    const location = await requireActiveLocation(tx, locationId);
    await assertCapacity(tx, location, {
      units: input.quantity,
      plants: childType === UnitType.PLANT ? input.quantity : 0,
    });

    const stage =
      childType === UnitType.PLANT
        ? (input.growthStage ??
          (input.deriveType === "cutting"
            ? GrowthStage.VEGETATIVE
            : (parentState.growthStage ?? GrowthStage.VEGETATIVE)))
        : null;

    const prefix = `${parent.name}-${input.deriveType === "subculture" ? "SC" : "CL"}`;
    const firstIndex = input.name ? 1 : await nextFreeIndex(tx, prefix);
    const label = `${input.deriveType} from ${parent.name}`;

    const created: Array<{ id: number; name: string }> = [];
    for (let i = 0; i < input.quantity; i += 1) {
      const name = input.name
        ? input.quantity === 1
          ? input.name
          : `${input.name}-${i + 1}`
        : `${prefix}-${firstIndex + i}`;
      created.push(
        await createUnitWithFirstState(
          tx,
          actor,
          meta,
          {
            name,
            type: childType,
            experimentId,
            cultivarId: parent.cultivarId ?? 0,
            locationId: location.id,
            sex: parent.sex,
            comment: input.comment ?? null,
            sourceType: DERIVED_SOURCE[input.deriveType],
            sourceDescription: label,
            providerOrganizationId: null,
            sourceParentUnitId: parent.id,
            parentStateId: parentState.id,
            growthStage: stage,
            seedCount: null,
            humidWeight: null,
            dryWeight: null,
          },
          now,
          {
            action: "derive",
            summary: `Derived ${childType.toLowerCase()} ${name} (${label})`,
            changes: [{ field: "parent", from: null, to: parent.name }],
          }
        )
      );
    }

    await audit(tx, actor, meta, {
      entityType: "unit",
      entityId: parent.id,
      entityLabel: parent.name,
      action: "derive_parent",
      summary: `Produced ${created.length} ${input.deriveType}${created.length === 1 ? "" : "s"}: ${created
        .map((c) => c.name)
        .join(", ")}`,
    });

    return { parentName: parent.name, deriveType: input.deriveType, childType, units: created };
  }
}

// -----------------------------------------------------------------------------
// Events on an existing unit
// -----------------------------------------------------------------------------

export async function moveUnit(
  actor: Actor,
  unitId: number,
  input: MoveUnitInput,
  options: { requireScan: boolean },
  meta?: RequestMeta
) {
  return prisma.$transaction(
    (tx) => moveUnitTx(tx, actor, unitId, input, options, meta),
    TRANSACTION
  );
}

/** Same as moveUnit, inside a caller-owned transaction (so several commands can commit together). */
export async function moveUnitTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: MoveUnitInput,
  options: { requireScan: boolean },
  meta?: RequestMeta
) {
  const unit = await lockUnit(tx, unitId);
  await assertCanEditUnit(tx, actor, unit);
  const current = assertActive(unit);
  assertNotOnHold(unit);

  const scanned = input.barcode !== undefined;
  if (options.requireScan && !scanned) {
    throw errors.forbidden("Scan the unit's barcode to confirm the move");
  }
  if (scanned && input.barcode !== getUnitBarcodeValue(unit.id, unit.name)) {
    throw errors.forbidden("Barcode scan did not match this unit — move not confirmed");
  }

  if (current.locationId === input.toLocationId) {
    throw errors.conflict("The unit is already in that location");
  }
  const destination = await requireActiveLocation(tx, input.toLocationId);
  await assertCapacity(tx, destination, {
    units: 1,
    plants: unit.type === UnitType.PLANT ? (current.plantCount ?? 1) : 0,
    grams: countedGrams({
      dryWeight: current.dryWeight === null ? null : Number(current.dryWeight),
      humidWeight: current.humidWeight === null ? null : Number(current.humidWeight),
    }),
  });
  const origin = current.locationId
    ? await tx.location.findUnique({ where: { id: current.locationId }, select: { name: true } })
    : null;

  const now = new Date();
  await appendState(
    tx,
    actor,
    unit,
    UnitStateKind.MOVED,
    { locationId: destination.id, scanConfirmed: scanned, comment: input.comment },
    now
  );
  await audit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "transfer",
    summary: `Transferred to ${destination.name}${scanned ? " (barcode confirmed)" : ""}`,
    changes: [{ field: "location", from: origin?.name ?? null, to: destination.name }],
  });
  return { location: destination.name, scanConfirmed: scanned };
}

export async function changeStage(
  actor: Actor,
  unitId: number,
  input: ChangeStageInput,
  meta?: RequestMeta
) {
  return prisma.$transaction((tx) => changeStageTx(tx, actor, unitId, input, meta), TRANSACTION);
}

/** Same as changeStage, inside a caller-owned transaction (so several commands can commit together). */
export async function changeStageTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: ChangeStageInput,
  meta?: RequestMeta
) {
  const unit = await lockUnit(tx, unitId);
  await assertCanEditUnit(tx, actor, unit);
  const current = assertActive(unit);
  assertNotOnHold(unit);

  if (unit.type !== UnitType.PLANT && unit.type !== UnitType.FLOWER) {
    throw errors.validation("Stage changes apply to plants and flowers");
  }
  if (current.growthStage === input.toStage) {
    throw errors.conflict("The unit is already in that stage");
  }
  if (!isLaterStage(current.growthStage, input.toStage)) {
    throw errors.rule(
      "stageBackward",
      "Stages only move forward: the unit cannot go back to an earlier stage",
      {
        stage: input.toStage,
      }
    );
  }

  const now = new Date();
  const effectiveAt = resolveDate(input.effectiveAt, now);
  await assertEffectiveAt(tx, unit.id, effectiveAt, now);

  await appendState(
    tx,
    actor,
    unit,
    UnitStateKind.STAGE_CHANGED,
    { growthStage: input.toStage, comment: input.comment },
    effectiveAt
  );
  const backDated = effectiveAt.getTime() < now.getTime() - 60_000;
  await audit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "stage_transition",
    summary: `Stage: ${current.growthStage ?? "—"} → ${input.toStage}${backDated ? " (back-dated)" : ""}`,
    changes: [{ field: "stage", from: current.growthStage, to: input.toStage }],
  });
  return { fromStage: current.growthStage, toStage: input.toStage, effectiveAt };
}

export async function measureUnit(
  actor: Actor,
  unitId: number,
  input: MeasureUnitInput,
  meta?: RequestMeta
) {
  return prisma.$transaction((tx) => measureUnitTx(tx, actor, unitId, input, meta), TRANSACTION);
}

/** Same as measureUnit, inside a caller-owned transaction (so several commands can commit together). */
export async function measureUnitTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: MeasureUnitInput,
  meta?: RequestMeta
) {
  const unit = await lockUnit(tx, unitId);
  await assertCanEditUnit(tx, actor, unit);
  const current = assertActive(unit);

  const weighsUnit = unit.type === UnitType.PLANT || unit.type === UnitType.FLOWER;
  const wantsWeight = input.humidWeight !== undefined || input.dryWeight !== undefined;
  if (wantsWeight && !weighsUnit) {
    throw errors.validation("Weights apply to plants and flowers");
  }
  if (input.seedCount !== undefined && unit.type !== UnitType.SEEDLOT) {
    throw errors.validation("A seed count applies to seed lots");
  }
  // A weight on record is not overwritten by members: a mistake is reported as an incident, and an
  // administrator corrects it, saying why.
  const overwrites =
    (input.humidWeight !== undefined && current.humidWeight !== null) ||
    (input.dryWeight !== undefined && current.dryWeight !== null);
  if (overwrites && !isAdmin(actor)) {
    throw errors.rule(
      "weightRecorded",
      "This weight is already recorded. Report the mistake as an incident: an administrator corrects it."
    );
  }
  if (overwrites && !input.comment?.trim()) {
    throw errors.rule("correctionReason", "Say why the weight is corrected");
  }

  const now = new Date();
  const effectiveAt = resolveDate(input.effectiveAt, now);
  await assertEffectiveAt(tx, unit.id, effectiveAt, now);

  await appendState(
    tx,
    actor,
    unit,
    UnitStateKind.MEASURED,
    {
      humidWeight: input.humidWeight,
      dryWeight: input.dryWeight,
      seedCount: input.seedCount,
      comment: input.comment,
    },
    effectiveAt
  );

  const changes = buildChanges([
    ...(input.humidWeight !== undefined
      ? [
          {
            field: "wet weight (g)",
            from: current.humidWeight?.toString(),
            to: input.humidWeight,
          },
        ]
      : []),
    ...(input.dryWeight !== undefined
      ? [{ field: "dry weight (g)", from: current.dryWeight?.toString(), to: input.dryWeight }]
      : []),
    ...(input.seedCount !== undefined
      ? [{ field: "seed count", from: current.seedCount, to: input.seedCount }]
      : []),
  ]);
  await audit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "measure",
    summary: `Recorded ${changes.map((c) => c.field).join(", ") || "measurement"}`,
    changes,
  });
  return { changes };
}

export async function destroyUnit(
  actor: Actor,
  unitId: number,
  input: DestroyUnitInput,
  meta?: RequestMeta
) {
  return prisma.$transaction((tx) => destroyUnitTx(tx, actor, unitId, input, meta), TRANSACTION);
}

/** Same as destroyUnit, inside a caller-owned transaction (so several units commit together). */
export async function destroyUnitTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: DestroyUnitInput,
  meta?: RequestMeta
) {
  // Destruction is final. An administrator records it, or a member of the unit's experiment (the
  // team lead's rule of 2026-11-07); a reason is always required and no second person is needed.
  if (!isAdmin(actor) && actor.permissions !== "REGULAR") {
    throw errors.forbidden(
      "Only an administrator or a member of the experiment can record a destruction"
    );
  }
  const unit = await lockUnit(tx, unitId);
  await assertCanEditUnit(tx, actor, unit);
  assertActive(unit);
  assertNotOnHold(unit);

  const now = new Date();
  const effectiveAt = resolveDate(input.effectiveAt, now);
  await assertEffectiveAt(tx, unit.id, effectiveAt, now);

  await appendState(
    tx,
    actor,
    unit,
    UnitStateKind.DESTROYED,
    { reason: input.reason },
    effectiveAt
  );
  await audit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "destroy",
    summary: `Recorded destruction: ${input.reason}`,
    reason: input.reason,
    changes: [{ field: "inventory", from: "active", to: "destroyed" }],
  });
  return { destroyedAt: effectiveAt };
}

// -----------------------------------------------------------------------------
// Details and lineage (not part of the event ledger, but audited)
// -----------------------------------------------------------------------------

export async function updateUnitDetails(
  actor: Actor,
  unitId: number,
  input: UpdateUnitDetailsInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(
    (tx) => updateUnitDetailsTx(tx, actor, unitId, input, meta),
    TRANSACTION
  );
}

/** Same as updateUnitDetails, inside a caller-owned transaction (so several commands can commit together). */
export async function updateUnitDetailsTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: UpdateUnitDetailsInput,
  meta?: RequestMeta
) {
  const unit = await lockUnit(tx, unitId);
  const destroyed = unit.currentState?.kind === UnitStateKind.DESTROYED;

  if (destroyed) {
    assertCanAnnotateDestroyedUnit(actor);
    if (input.sex !== undefined || input.comment === undefined) {
      throw errors.validation("Only notes can be changed on a destroyed unit");
    }
  } else {
    await assertCanEditUnit(tx, actor, unit);
    assertActive(unit);
  }

  const changes = buildChanges([
    ...(input.comment !== undefined
      ? [{ field: "notes", from: unit.comment, to: input.comment }]
      : []),
    ...(input.sex !== undefined ? [{ field: "sex", from: unit.sex, to: input.sex }] : []),
  ]);
  if (changes.length === 0) return { unchanged: true as const, changes };

  await tx.biologicalUnit.update({
    where: { id: unit.id },
    data: {
      ...(input.comment !== undefined ? { comment: input.comment || null } : {}),
      ...(input.sex !== undefined ? { sex: input.sex || null } : {}),
    },
  });
  await audit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "update",
    summary: destroyed
      ? "Updated admin notes on destroyed unit"
      : `Updated ${changes.map((c) => c.field).join(", ")}`,
    changes,
  });
  return { unchanged: false as const, changes };
}

export async function linkParent(
  actor: Actor,
  unitId: number,
  input: LinkParentInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    await assertCanEditUnit(tx, actor, unit);
    assertActive(unit);

    if (input.parentUnitId === unit.id) throw errors.validation("A unit cannot be its own parent");
    if (unit.sourceParentUnitId) throw errors.conflict("Lineage is already linked for this unit");

    const parent = await tx.biologicalUnit.findUnique({
      where: { id: input.parentUnitId },
      select: { id: true, name: true, currentStateId: true },
    });
    if (!parent) throw errors.notFound("Parent unit");

    // Walk up from the proposed parent: reaching this unit would close a loop.
    let cursor: number | null = parent.id;
    for (let depth = 0; cursor !== null && depth < MAX_LINEAGE_DEPTH; depth += 1) {
      if (cursor === unit.id) throw errors.conflict("That link would create a lineage loop");
      const next: { sourceParentUnitId: number | null } | null = await tx.biologicalUnit.findUnique(
        {
          where: { id: cursor },
          select: { sourceParentUnitId: true },
        }
      );
      cursor = next?.sourceParentUnitId ?? null;
    }

    await tx.biologicalUnit.update({
      where: { id: unit.id },
      data: { sourceParentUnitId: parent.id },
    });
    await audit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "lineage",
      summary: `Linked parent ${parent.name}${input.comment ? `: ${input.comment}` : ""}`,
      changes: [{ field: "parent", from: null, to: parent.name }],
    });
    return { parentName: parent.name };
  }, TRANSACTION);
}

export type { UnitState };
export { isTerminalKind };

/**
 * Applies several edits to one unit atomically (the legacy "edit tracking" panel sends them
 * together). Each edit becomes the proper event or audited change; values that are already
 * current are skipped, as the old endpoint did.
 */
export async function editUnit(
  actor: Actor,
  unitId: number,
  edits: {
    details?: UpdateUnitDetailsInput;
    locationId?: number;
    growthStage?: GrowthStage;
    measure?: { humidWeight?: number; dryWeight?: number; seedCount?: number };
  },
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const applied: string[] = [];
    const current = async () => (await lockUnit(tx, unitId)).currentState;

    if (edits.details) {
      const result = await updateUnitDetailsTx(tx, actor, unitId, edits.details, meta);
      if (!result.unchanged) applied.push(...result.changes.map((c) => c.field));
    }
    if (edits.locationId !== undefined && (await current())?.locationId !== edits.locationId) {
      await moveUnitTx(
        tx,
        actor,
        unitId,
        { toLocationId: edits.locationId },
        { requireScan: false },
        meta
      );
      applied.push("location");
    }
    if (edits.growthStage !== undefined && (await current())?.growthStage !== edits.growthStage) {
      await changeStageTx(tx, actor, unitId, { toStage: edits.growthStage }, meta);
      applied.push("growth stage");
    }
    const m = edits.measure;
    if (
      m &&
      (m.humidWeight !== undefined || m.dryWeight !== undefined || m.seedCount !== undefined)
    ) {
      const state = await current();
      const differs =
        (m.humidWeight !== undefined && Number(state?.humidWeight ?? NaN) !== m.humidWeight) ||
        (m.dryWeight !== undefined && Number(state?.dryWeight ?? NaN) !== m.dryWeight) ||
        (m.seedCount !== undefined && state?.seedCount !== m.seedCount);
      if (differs) {
        await measureUnitTx(tx, actor, unitId, m, meta);
        applied.push("measurements");
      }
    }
    return { applied };
  }, TRANSACTION);
}
