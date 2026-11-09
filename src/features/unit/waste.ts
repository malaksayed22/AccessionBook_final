import "server-only";
import { Moisture, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { resolveEffectiveAt } from "@/lib/lab-time";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanEditUnit } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import type { RecordWasteInput } from "./schemas";
import {
  appendState,
  assertActive,
  assertNotOnHold,
  assertWithinBackdateLimit,
  lockUnit,
} from "./state-engine";

const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** Stages in which a plant is harvested material, weighed rather than counted. */
const HARVESTED_STAGES: ReadonlySet<string> = new Set(["HARVESTED", "DRYING", "CURING", "STORAGE"]);

/**
 * Disposes of part of a unit as waste: trim, stems and leaves, roots or other plant matter. The unit
 * records a WASTED event with what was disposed of, how, and what is left; on the CTLS return it is
 * destroyed. Weighed material only (a flower, or a plant once harvested), in grams on the basis the
 * unit is weighed on. A hold blocks it, as it blocks every custody change. Destroying a whole unit
 * stays an administrator's record; waste is the routine work of whoever may change the unit.
 */
export async function recordWaste(
  actor: SessionUser,
  unitId: number,
  input: RecordWasteInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    await assertCanEditUnit(tx, actor, unit);
    const current = assertActive(unit);
    assertNotOnHold(unit);

    const weighed =
      unit.type === UnitType.FLOWER ||
      (unit.type === UnitType.PLANT && HARVESTED_STAGES.has(current.growthStage ?? ""));
    if (!weighed) {
      throw errors.rule(
        "wasteNotApplicable",
        "Waste is recorded on flowers and harvested plants, by weight"
      );
    }
    const dry = current.dryWeight !== null;
    const availableRaw = dry ? current.dryWeight : current.humidWeight;
    if (availableRaw === null) {
      throw errors.rule("wasteNeedsWeight", "Record the unit's weight before recording waste");
    }
    const available = Number(availableRaw);
    if (input.amount >= available) {
      throw errors.rule(
        "wasteTooLarge",
        "Waste is part of the unit, not all of it. Record the destruction of the unit instead.",
        { available }
      );
    }

    const now = new Date();
    const effectiveAt = input.effectiveAt
      ? resolveEffectiveAt(input.effectiveAt, now, env().LAB_TIMEZONE)
      : now;
    if (!effectiveAt) throw errors.validation("The date is not valid", { fields: ["effectiveAt"] });
    if (effectiveAt.getTime() > now.getTime() + 1000) {
      throw errors.rule("wasteInFuture", "Waste cannot be dated in the future");
    }
    await assertWithinBackdateLimit(tx, effectiveAt, now);
    if (effectiveAt.getTime() < current.effectiveAt.getTime()) {
      throw errors.rule(
        "wasteBeforeLastEvent",
        "Waste cannot be dated before the unit's last recorded event"
      );
    }

    const left = round3(available - input.amount);
    await appendState(
      tx,
      actor,
      unit,
      UnitStateKind.WASTED,
      {
        ...(dry ? { dryWeight: left } : { humidWeight: left }),
        shippedWeight: input.amount,
        shippedMoisture: dry ? Moisture.DRY : Moisture.WET,
        wasteType: input.type,
        reason: input.method,
        comment: input.comment,
      },
      effectiveAt
    );
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "waste",
      summary: `Disposed of ${input.amount} g ${dry ? "dry" : "wet"} ${input.type} as waste (${input.method})`,
      changes: [
        {
          field: dry ? "dry weight (g)" : "wet weight (g)",
          from: String(available),
          to: String(left),
        },
      ],
    });
    return { unitName: unit.name, left };
  }, TRANSACTION);
}
