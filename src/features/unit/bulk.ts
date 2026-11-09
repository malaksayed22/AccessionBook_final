import "server-only";
import { HoldKind } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { placeHoldTx, releaseHoldTx } from "@/features/qa/service";
import { type RequestMeta } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError, errors } from "@/server/errors";
import type { Tx } from "./state-engine";
import { recordActivityTx } from "./documents";
import type { BulkUnitsInput } from "./schemas";
import { changeStageTx, destroyUnitTx, moveUnitTx } from "./service";

const TRANSACTION = { timeout: 120_000, maxWait: 15_000 } as const;

async function applyOne(
  tx: Tx,
  actor: SessionUser,
  unitId: number,
  input: BulkUnitsInput,
  meta?: RequestMeta
) {
  switch (input.action) {
    case "move":
      return moveUnitTx(
        tx,
        actor,
        unitId,
        { toLocationId: input.toLocationId, comment: input.comment },
        { requireScan: false },
        meta
      );
    case "stage":
      return changeStageTx(
        tx,
        actor,
        unitId,
        { toStage: input.toStage, effectiveAt: input.effectiveAt, comment: input.comment },
        meta
      );
    case "hold":
      return placeHoldTx(tx, actor, unitId, { reason: input.reason, kind: HoldKind.HOLD }, meta);
    case "destroy":
      return destroyUnitTx(
        tx,
        actor,
        unitId,
        { reason: input.reason, effectiveAt: input.effectiveAt },
        meta
      );
    case "release":
      return releaseHoldTx(tx, actor, unitId, { note: input.reason }, meta);
    case "activity": {
      const { action: _action, unitIds: _unitIds, ...activity } = input;
      return recordActivityTx(tx, actor, unitId, activity, meta);
    }
  }
}

/**
 * One action on several units, all or nothing: every unit goes through the same checks and writes the
 * same history and audit entries as the single-unit action, in one transaction, so a unit that cannot
 * take the action (a hold, a destroyed unit, no room, no right to edit it) stops the whole batch and
 * nothing changes. The error names the unit. Units are taken in id order, so two batches cannot
 * deadlock on each other.
 */
export async function applyBulk(actor: SessionUser, input: BulkUnitsInput, meta?: RequestMeta) {
  const unitIds = [...new Set(input.unitIds)].sort((a, b) => a - b);
  return prisma.$transaction(async (tx) => {
    const units = await tx.biologicalUnit.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
    if (units.length !== unitIds.length) throw errors.notFound("Unit");

    for (const unit of units) {
      try {
        await applyOne(tx, actor, unit.id, input, meta);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        const details =
          typeof error.details === "object" && error.details !== null ? error.details : {};
        throw new AppError(error.code, `${unit.name}: ${error.message}`, {
          ...details,
          bulkUnit: unit.name,
        });
      }
    }
    return { action: input.action, count: units.length, units };
  }, TRANSACTION);
}
