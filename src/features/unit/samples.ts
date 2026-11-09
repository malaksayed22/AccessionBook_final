import "server-only";
import { Moisture, SourceType, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanRecordQuality } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { TakeSampleInput } from "./schemas";
import {
  assertCapacity,
  createUnitWithFirstState,
  nextFreeIndex,
  requireActiveLocation,
} from "./service";
import { appendState, assertActive, lockUnit } from "./state-engine";

const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Takes part of a unit as a sample. The parent records a SAMPLED event with what was taken and
 * what is left; the sample becomes a unit of its own (its own label, history and lab results),
 * linked to the parent and to that event. Flowers are sampled by weight, on the basis they are
 * weighed on (dry once a dry weight exists), seed lots by count. A held unit may be sampled: that is
 * how held material gets tested. Quality assurance, or whoever may change the unit.
 */
export async function takeSample(
  actor: SessionUser,
  parentUnitId: number,
  input: TakeSampleInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const parent = await lockUnit(tx, parentUnitId);
    await assertCanRecordQuality(tx, actor, parent);
    const current = assertActive(parent);
    if (parent.type !== UnitType.FLOWER && parent.type !== UnitType.SEEDLOT) {
      throw errors.rule(
        "sampleNotApplicable",
        "Samples are taken from flowers (by weight) or seed lots (by count)"
      );
    }
    if (!parent.experimentId) throw errors.validation("An experiment is required");

    const byCount = parent.type === UnitType.SEEDLOT;
    const dry = !byCount && current.dryWeight !== null;
    const availableRaw = byCount
      ? current.seedCount
      : dry
        ? current.dryWeight
        : current.humidWeight;
    const available = availableRaw === null ? null : Number(availableRaw);
    if (available === null) {
      throw errors.rule(
        "sampleNeedsQuantity",
        "Record the unit's weight or seed count before taking a sample"
      );
    }
    if (byCount && !Number.isInteger(input.amount)) {
      throw errors.validation("A seed sample is a whole number of seeds", { fields: ["amount"] });
    }
    if (input.amount >= available) {
      throw errors.rule(
        "sampleTooLarge",
        "A sample takes part of the unit, not all of it. Ship or destroy the unit instead.",
        { available }
      );
    }

    const locationId = input.locationId ?? current.locationId;
    if (!locationId) throw errors.validation("A location is required");
    const location = await requireActiveLocation(tx, locationId);
    await assertCapacity(tx, location, { units: 1, plants: 0 });

    const now = new Date();
    const left = byCount ? available - input.amount : round3(available - input.amount);
    const sampled = await appendState(
      tx,
      actor,
      parent,
      UnitStateKind.SAMPLED,
      {
        ...(byCount ? { seedCount: left } : dry ? { dryWeight: left } : { humidWeight: left }),
        shippedWeight: byCount ? undefined : input.amount,
        shippedMoisture: byCount ? undefined : dry ? Moisture.DRY : Moisture.WET,
        shippedCount: byCount ? input.amount : undefined,
        comment: input.comment,
      },
      now
    );

    const prefix = `${parent.name}-S`;
    const name = `${prefix}-${await nextFreeIndex(tx, prefix)}`;
    const amountText = byCount
      ? `${input.amount} seeds`
      : `${input.amount} g ${dry ? "dry" : "wet"}`;
    const sample = await createUnitWithFirstState(
      tx,
      actor,
      meta,
      {
        name,
        type: parent.type,
        experimentId: parent.experimentId,
        cultivarId: parent.cultivarId ?? 0,
        locationId: location.id,
        sex: parent.sex,
        comment: input.comment ?? null,
        sourceType: SourceType.INTERNAL,
        sourceDescription: `${input.kind} sample of ${parent.name}`,
        providerOrganizationId: null,
        sourceParentUnitId: parent.id,
        parentStateId: sampled.id,
        growthStage: current.growthStage,
        seedCount: byCount ? input.amount : null,
        humidWeight: byCount || dry ? null : input.amount,
        dryWeight: dry ? input.amount : null,
        sampleKind: input.kind,
      },
      now,
      {
        action: "sample",
        summary: `${input.kind} sample ${name} taken from ${parent.name} (${amountText})`,
        changes: [{ field: "parent", from: null, to: parent.name }],
      }
    );
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: parent.id,
      entityLabel: parent.name,
      action: "sample_parent",
      summary: `Took ${input.kind} sample ${name} (${amountText})`,
    });
    return { sample: { id: sample.id, name: sample.name }, parentName: parent.name };
  }, TRANSACTION);
}
