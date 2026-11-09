import "server-only";
import { GrowthStage, SourceType, UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { unitCodeFor } from "@/lib/experiment-codes";
import {
  expandIntakeUnits,
  findIntakeKind,
  totalIntakeUnits,
  validateIntake,
  type IntakeGroupInput,
  type ProviderMode,
} from "@/lib/experiment-intake";
import { assessLocationCapacity } from "@/lib/location-capacity";
import { validateExperimentInput } from "@/lib/provenance";
import { zonedDateKey } from "@/lib/lab-time";
import { measureForMaterial } from "@/lib/materials";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanEditExperiment, assertCanEditUnit, isAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import { createIntakeReceipt } from "@/features/shipment/service";
import {
  assertCapacity,
  createUnitWithFirstState,
  deriveUnitsTx,
  requireActiveLocation,
} from "@/features/unit/service";
import type { Tx } from "@/features/unit/state-engine";
import type { DeriveUnitInput } from "@/features/unit/schemas";
import type {
  CompleteExperimentInput,
  CreateExperimentInput,
  UpdateExperimentInput,
} from "./schemas";
import { buildIntakeReceiptItems, type CreatedIntakeUnit } from "./receipt-items";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";
import { getLabSettings } from "@/server/settings";

/**
 * Experiments: creation (optionally with its starting units, all in one transaction), membership,
 * edits, completion. Experiment codes come from an atomic counter with one system-wide prefix.
 */
const TRANSACTION = { timeout: 120_000, maxWait: 15_000 } as const;

type Actor = SessionUser;

/** Today in the laboratory's time zone, as an experiment stores a day: midnight UTC of that date. */
function labToday(): Date {
  return new Date(`${zonedDateKey(new Date(), env().LAB_TIMEZONE)}T00:00:00Z`);
}

function toGroups(input: CreateExperimentInput): IntakeGroupInput[] {
  return (input.unitGroups ?? []).map((g) => ({
    kind: g.kind,
    cultivarId: g.cultivarId ?? null,
    cultivarMode: g.cultivarMode,
    cultivarBreakdown: (g.cultivarBreakdown ?? []).filter((s) => s.count > 0),
    quantity: g.quantity,
    statusMode: g.statusMode,
    status: g.status ?? null,
    breakdown: (g.breakdown ?? []).filter((s) => s.count > 0),
    seedsPerLot: g.seedsPerLot ?? null,
    wetWeightGrams: g.wetWeightGrams ?? null,
    dryWeightGrams: g.dryWeightGrams ?? null,
  }));
}

function parseDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw errors.validation(`${label} is not a valid date`);
  return date;
}

async function nextExperimentCode(tx: Tx, prefix: string): Promise<string> {
  const rows = await tx.$queryRaw<
    Array<{ n: number }>
  >`SELECT next_experiment_number(${prefix}) AS n`;
  const number = rows[0]?.n;
  if (!number) throw errors.conflict("Could not allocate an experiment code — please retry");
  return `${prefix}${number}`;
}

export async function createExperiment(
  actor: Actor,
  input: CreateExperimentInput,
  meta?: RequestMeta
) {
  const dateError = validateExperimentInput({ name: input.name, startDate: input.startDate });
  if (dateError) throw errors.validation(dateError);
  const startDate = parseDate(input.startDate, "Start date");
  const estimatedEndDate = input.estimatedEndDate
    ? parseDate(input.estimatedEndDate, "Estimated end date")
    : null;
  if (estimatedEndDate && estimatedEndDate < startDate) {
    throw errors.rule(
      "estimateBeforeStart",
      "The estimated end date cannot be before the start date"
    );
  }

  const groups = toGroups(input);
  const providerMode: ProviderMode = input.providerMode;
  const providerOrganizationId =
    providerMode === "EXTERNAL" ? (input.providerOrganizationId ?? null) : null;
  const intakeError = validateIntake({
    locationId: input.locationId ?? null,
    providerMode,
    providerOrganizationId,
    sourceDescription: input.sourceDescription ?? null,
    groups,
  });
  if (intakeError) throw errors.validation(intakeError);

  const plannedUnits = totalIntakeUnits(groups);
  const createReceipt =
    input.createReceipt !== false && providerMode === "EXTERNAL" && plannedUnits > 0;

  return prisma.$transaction(async (tx) => {
    if (input.parentExperimentId) {
      const parent = await tx.experiment.findUnique({ where: { id: input.parentExperimentId } });
      if (!parent) throw errors.notFound("Parent experiment");
      await assertCanEditExperiment(
        tx,
        actor,
        parent.id,
        "You must be a member of the parent experiment"
      );
    }
    if (input.sourceUnitId) {
      const source = await tx.biologicalUnit.findUnique({
        where: { id: input.sourceUnitId },
        select: { id: true, experimentId: true },
      });
      if (!source) throw errors.notFound("Source unit");
      await assertCanEditUnit(tx, actor, source);
    }

    let capacityNote: string | null = null;
    const location =
      plannedUnits > 0 && input.locationId
        ? await requireActiveLocation(tx, input.locationId)
        : null;
    if (location) {
      try {
        await assertCapacity(tx, location, plannedUnits);
      } catch (error) {
        if (!input.ignoreCapacityWarning) {
          throw errors.conflict(
            error instanceof Error ? error.message : "Location capacity exceeded",
            { capacityExceeded: true }
          );
        }
        capacityNote = error instanceof Error ? error.message : null;
      }
    }

    const provider = providerOrganizationId
      ? await tx.organization.findUnique({ where: { id: providerOrganizationId } })
      : null;
    if (providerMode === "EXTERNAL" && !provider) {
      throw errors.validation("Provider organization is not registered — create its profile first");
    }

    const cultivarIds = [
      ...new Set(
        groups.flatMap((g) =>
          g.cultivarMode === "MIXED"
            ? (g.cultivarBreakdown ?? []).map((s) => s.cultivarId)
            : g.cultivarId
              ? [g.cultivarId]
              : []
        )
      ),
    ];
    const cultivars = await tx.cultivar.findMany({
      where: { id: { in: cultivarIds } },
      select: { id: true, name: true },
    });
    if (cultivars.length !== cultivarIds.length)
      throw errors.validation("Unknown cultivar selected");
    const cultivarNames = new Map(cultivars.map((c) => [c.id, c.name]));

    const ecode = await nextExperimentCode(tx, (await getLabSettings(tx)).experimentCodePrefix);
    const experiment = await tx.experiment.create({
      data: {
        ecode,
        name: input.name,
        startDate,
        estimatedEndDate,
        comment: input.comment ?? null,
        parentExperimentId: input.parentExperimentId ?? null,
        sourceUnitId: input.sourceUnitId ?? null,
      },
    });
    await tx.experimentMember.create({
      data: { experimentId: experiment.id, userId: actor.id, role: "LEAD" },
    });
    if (isAdmin(actor) && input.memberIds?.length) {
      const extra = [...new Set(input.memberIds)].filter((id) => id !== actor.id);
      const members = await tx.user.findMany({
        where: { id: { in: extra }, active: true },
        select: { id: true },
      });
      await tx.experimentMember.createMany({
        data: members.map((m) => ({
          experimentId: experiment.id,
          userId: m.id,
          role: "MEMBER" as const,
        })),
        skipDuplicates: true,
      });
    }

    // Intake units cannot be dated in the future even if the experiment starts later.
    const now = new Date();
    const intakeDate = startDate.getTime() > now.getTime() ? now : startDate;
    const created: Array<CreatedIntakeUnit & { cultivarName: string | null }> = [];
    let sequence = 0;
    for (const group of groups) {
      const kind = findIntakeKind(group.kind);
      if (!kind || !location) continue;
      for (const slot of expandIntakeUnits(group)) {
        sequence += 1;
        const name = unitCodeFor(ecode, sequence);
        const type = UnitType[kind.unitType];
        const weighed = !!kind.tracksWeight;
        const unit = await createUnitWithFirstState(
          tx,
          actor,
          meta,
          {
            name,
            type,
            experimentId: experiment.id,
            cultivarId: slot.cultivarId,
            locationId: location.id,
            sex: null,
            comment: null,
            sourceType:
              providerMode === "INTERNAL" ? SourceType.INTERNAL : (kind.sourceType as SourceType),
            sourceDescription: input.sourceDescription || `Intake for experiment ${ecode}`,
            providerOrganizationId,
            sourceParentUnitId: null,
            parentStateId: null,
            growthStage:
              type === UnitType.PLANT
                ? ((slot.stage as GrowthStage | null) ?? GrowthStage.VEGETATIVE)
                : type === UnitType.FLOWER
                  ? ((slot.stage as GrowthStage | null) ?? GrowthStage.HARVESTED)
                  : null,
            seedCount: kind.tracksSeedCount ? (group.seedsPerLot ?? null) : null,
            humidWeight: weighed ? (group.wetWeightGrams ?? null) : null,
            dryWeight: weighed ? (group.dryWeightGrams ?? null) : null,
          },
          intakeDate,
          {
            action: "create",
            summary: `Registered ${type.toLowerCase()} ${name} at intake for ${ecode}`,
            changes: [{ field: "location", from: null, to: location.name }],
          }
        );
        created.push({
          unitId: unit.id,
          stateId: unit.stateId,
          name,
          type,
          cultivarId: slot.cultivarId,
          cultivarName: cultivarNames.get(slot.cultivarId) ?? null,
        });
      }
    }

    let receipt: { id: number; reference: string } | null = null;
    if (createReceipt && providerOrganizationId && created.length > 0) {
      receipt = await createIntakeReceipt(tx, actor, {
        organizationId: providerOrganizationId,
        experimentCode: ecode,
        licenceNumber: provider?.licenceNumber ?? null,
        deliveredDate: intakeDate,
        items: buildIntakeReceiptItems(groups, created).map((item) => ({
          ...item,
          measure: measureForMaterial(item.materialType) as typeof item.measure,
        })),
      });
    }

    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: ecode,
      action: "create",
      summary:
        `Created experiment ${ecode}: ${input.name}` +
        (input.parentExperimentId ? " (sub-experiment)" : "") +
        (created.length
          ? ` with ${created.length} ${created.length === 1 ? "unit" : "units"}`
          : "") +
        (receipt ? `; receipt ${receipt.reference}` : "") +
        (capacityNote ? "; capacity override" : ""),
      changes: [
        { field: "lead", from: null, to: actor.name },
        { field: "started", from: null, to: input.startDate },
        ...(estimatedEndDate
          ? [{ field: "estimated end", from: null, to: input.estimatedEndDate ?? null }]
          : []),
        ...(created.length
          ? [
              { field: "units", from: null, to: String(created.length) },
              {
                field: "unit codes",
                from: null,
                to: `${created[0]?.name} … ${created.at(-1)?.name}`,
              },
            ]
          : []),
        ...(receipt ? [{ field: "receipt", from: null, to: receipt.reference }] : []),
        ...(capacityNote ? [{ field: "capacity override", from: null, to: capacityNote }] : []),
      ],
    });

    const capacityCheck = location
      ? assessLocationCapacity(
          {
            id: location.id,
            name: location.name,
            capacity: location.capacity,
            // Occupancy already includes the units just created in this transaction.
            occupancy: Math.max(0, (await countOccupancy(tx, location.id)) - created.length),
          },
          created.length
        )
      : { ok: true, message: null };

    return {
      id: experiment.id,
      ecode,
      units: created.map(({ unitId, name, type, cultivarName }) => ({
        unitId,
        name,
        type,
        cultivarName,
      })),
      plannedUnits,
      receipt: receipt ? { ...receipt, href: `/inventory/materials/${receipt.id}` } : null,
      capacityWarning: capacityCheck.message,
    };
  }, TRANSACTION);
}

/**
 * Derives clones, cuttings or subcultures into a NEW experiment, all in one transaction: the new
 * experiment is a sub-experiment of the parent's (with the parent unit as its source) led by the
 * person deriving, and the new units belong to it. If the derivation is refused (a hold, no room),
 * the experiment is not created either.
 */
export async function deriveIntoNewExperiment(
  actor: Actor,
  parentUnitId: number,
  input: DeriveUnitInput & { newExperiment: { name: string } },
  meta?: RequestMeta
) {
  const name = input.newExperiment.name.trim();
  const startDate = labToday();
  const nameError = validateExperimentInput({
    name,
    startDate: startDate.toISOString().slice(0, 10),
  });
  if (nameError) throw errors.validation(nameError);

  return prisma.$transaction(async (tx) => {
    const parent = await tx.biologicalUnit.findUnique({
      where: { id: parentUnitId },
      select: { id: true, name: true, experimentId: true },
    });
    if (!parent) throw errors.notFound("Unit");
    await assertCanEditUnit(tx, actor, parent);
    if (parent.experimentId) {
      await assertCanEditExperiment(
        tx,
        actor,
        parent.experimentId,
        "You must be a member of the parent experiment"
      );
    }

    const ecode = await nextExperimentCode(tx, (await getLabSettings(tx)).experimentCodePrefix);
    const experiment = await tx.experiment.create({
      data: {
        ecode,
        name,
        startDate,
        parentExperimentId: parent.experimentId,
        sourceUnitId: parent.id,
      },
    });
    await tx.experimentMember.create({
      data: { experimentId: experiment.id, userId: actor.id, role: "LEAD" },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: ecode,
      action: "create",
      summary: `Created experiment ${ecode}: ${name} (sub-experiment, derived from ${parent.name})`,
      changes: [
        { field: "lead", from: null, to: actor.name },
        { field: "source unit", from: null, to: parent.name },
      ],
    });

    const result = await deriveUnitsTx(
      tx,
      actor,
      parentUnitId,
      { ...input, newExperiment: undefined, experimentId: experiment.id },
      meta
    );
    return { ...result, experiment: { id: experiment.id, ecode, name } };
  }, TRANSACTION);
}

async function countOccupancy(tx: Tx, locationId: number): Promise<number> {
  return tx.biologicalUnit.count({
    where: {
      currentState: {
        is: { locationId, kind: { notIn: [...NO_STOCK_KINDS] } },
      },
    },
  });
}

export async function addExperimentMember(
  actor: Actor,
  experimentId: number,
  userId: number,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    await assertCanEditExperiment(tx, actor, experimentId);
    if (!isAdmin(actor)) throw errors.forbidden("Only admins can assign members to experiments");

    const member = await tx.user.findFirst({
      where: { id: userId, active: true },
      select: { id: true, name: true },
    });
    if (!member) throw errors.validation("The member must be an active user");
    const existing = await tx.experimentMember.findUnique({
      where: { experimentId_userId: { experimentId, userId } },
    });
    if (existing) return { added: false as const, name: member.name };

    await tx.experimentMember.create({ data: { experimentId, userId, role: "MEMBER" } });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "update",
      summary: `Added ${member.name} to ${experiment.ecode}`,
      changes: [{ field: "member", from: null, to: member.name }],
    });
    return { added: true as const, name: member.name };
  });
}

export async function removeExperimentMember(
  actor: Actor,
  experimentId: number,
  userId: number,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    if (!isAdmin(actor)) throw errors.forbidden("Only admins can remove members from experiments");

    const membership = await tx.experimentMember.findUnique({
      where: { experimentId_userId: { experimentId, userId } },
      include: { user: { select: { name: true } } },
    });
    if (!membership) throw errors.notFound("Membership");
    if (membership.role === "LEAD") {
      throw errors.conflict("The lead of an experiment cannot be removed");
    }
    await tx.experimentMember.delete({ where: { experimentId_userId: { experimentId, userId } } });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "update",
      summary: `Removed ${membership.user.name} from ${experiment.ecode}`,
      changes: [{ field: "member", from: membership.user.name, to: null }],
    });
    return { removed: true as const };
  });
}

export async function updateExperiment(
  actor: Actor,
  experimentId: number,
  input: UpdateExperimentInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    await assertCanEditExperiment(tx, actor, experimentId);

    // Dates of the record itself are administrators' to correct, including a completed one.
    if ((input.startDate || input.endDate) && !isAdmin(actor)) {
      throw errors.forbidden("Only admins can change an experiment's start or completion date");
    }
    const startDate = input.startDate ? parseDate(input.startDate, "Start date") : undefined;
    const endDate = input.endDate ? parseDate(input.endDate, "Completion date") : undefined;
    if (endDate && !experiment.endDate) {
      throw errors.validation(
        "This experiment is still running. Complete it to set a completion date"
      );
    }
    const estimated =
      input.estimatedEndDate === undefined
        ? undefined
        : input.estimatedEndDate === ""
          ? null
          : parseDate(input.estimatedEndDate, "Estimated end date");
    const next = {
      name: input.name ?? experiment.name,
      comment: input.comment === undefined ? experiment.comment : input.comment || null,
      startDate: startDate ?? experiment.startDate,
      endDate: endDate ?? experiment.endDate,
      estimatedEndDate: estimated === undefined ? experiment.estimatedEndDate : estimated,
    };
    if (next.endDate && next.endDate < next.startDate) {
      throw errors.rule(
        "completionBeforeStart",
        "The completion date cannot be before the start date"
      );
    }
    if (endDate && endDate.getTime() > labToday().getTime()) {
      throw errors.rule("completionInFuture", "The completion date cannot be in the future");
    }
    if (next.estimatedEndDate && next.estimatedEndDate < next.startDate) {
      throw errors.rule(
        "estimateBeforeStart",
        "The estimated end date cannot be before the start date"
      );
    }
    const changes = [
      ...(next.name !== experiment.name
        ? [{ field: "name", from: experiment.name, to: next.name }]
        : []),
      ...(next.comment !== experiment.comment
        ? [{ field: "notes", from: experiment.comment, to: next.comment }]
        : []),
      ...(next.startDate.getTime() !== experiment.startDate.getTime()
        ? [
            {
              field: "start date",
              from: experiment.startDate.toISOString().slice(0, 10),
              to: next.startDate.toISOString().slice(0, 10),
            },
          ]
        : []),
      ...(next.endDate?.getTime() !== experiment.endDate?.getTime()
        ? [
            {
              field: "completion date",
              from: experiment.endDate?.toISOString().slice(0, 10) ?? null,
              to: next.endDate?.toISOString().slice(0, 10) ?? null,
            },
          ]
        : []),
      ...(next.estimatedEndDate?.getTime() !== experiment.estimatedEndDate?.getTime()
        ? [
            {
              field: "estimated end",
              from: experiment.estimatedEndDate?.toISOString().slice(0, 10) ?? null,
              to: next.estimatedEndDate?.toISOString().slice(0, 10) ?? null,
            },
          ]
        : []),
    ];
    if (changes.length === 0) return { unchanged: true as const };

    await tx.experiment.update({ where: { id: experiment.id }, data: next });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "update",
      summary: `Updated ${changes.map((c) => c.field).join(", ")}`,
      changes,
    });
    return { unchanged: false as const };
  });
}

/**
 * Marks an experiment completed. Its end date is the day it finished: the day the member picked,
 * or today. A completed experiment keeps its units and records; reopening clears the end date.
 */
export async function completeExperiment(
  actor: Actor,
  experimentId: number,
  input: CompleteExperimentInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    await assertCanEditExperiment(tx, actor, experimentId);
    if (experiment.endDate) throw errors.conflict("This experiment is already completed");

    const today = labToday();
    const endDate = input.endDate ? parseDate(input.endDate, "Completion date") : today;
    if (endDate < experiment.startDate) {
      throw errors.rule(
        "completionBeforeStart",
        "The completion date cannot be before the start date"
      );
    }
    if (endDate.getTime() > today.getTime()) {
      throw errors.rule("completionInFuture", "The completion date cannot be in the future");
    }

    await tx.experiment.update({ where: { id: experiment.id }, data: { endDate } });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "update",
      summary: `Completed ${experiment.ecode}`,
      changes: [{ field: "status", from: "running", to: "completed" }],
    });
    return { endDate };
  });
}

/** Puts a completed experiment back to running. Administrators only. */
export async function reopenExperiment(actor: Actor, experimentId: number, meta?: RequestMeta) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    if (!isAdmin(actor)) throw errors.forbidden("Only admins can reopen a completed experiment");
    if (!experiment.endDate) throw errors.conflict("This experiment is already running");

    await tx.experiment.update({ where: { id: experiment.id }, data: { endDate: null } });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "update",
      summary: `Reopened ${experiment.ecode}`,
      changes: [{ field: "status", from: "completed", to: "running" }],
    });
    return { reopened: true as const };
  });
}
