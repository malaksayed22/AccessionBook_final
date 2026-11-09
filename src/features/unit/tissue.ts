import "server-only";
import { UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanRecordQuality } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { TakeTissueSampleInput } from "./schemas";
import { assertActive, lockUnit } from "./state-engine";

/**
 * Takes a tissue sample of a plant or a culture for a lab test (a viroid screen, the sex of a
 * seedling, the cultivar's identity). The piece is too small to change what the unit counts for and
 * the test uses it up, so the unit's history and stock are unchanged: the sample gets a code
 * (`<unit>-T-<n>`) to label it, and the results are recorded on it. A held unit may be sampled;
 * that is how held material gets tested. Quality assurance, or whoever may change the unit.
 */
export async function takeTissueSample(
  actor: SessionUser,
  unitId: number,
  input: TakeTissueSampleInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    await assertCanRecordQuality(tx, actor, unit);
    assertActive(unit);
    if (unit.type !== UnitType.PLANT && unit.type !== UnitType.CULTURE) {
      throw errors.rule(
        "tissueNotApplicable",
        "Tissue samples are taken from plants and cultures; flowers and seed lots are sampled by amount"
      );
    }
    // The unit's row is locked, so the next number is this transaction's to take.
    const taken = await tx.tissueSample.count({ where: { unitId: unit.id } });
    const code = `${unit.name}-T-${taken + 1}`;
    const sample = await tx.tissueSample.create({
      data: {
        code,
        unitId: unit.id,
        purpose: input.purpose,
        tissue: input.tissue,
        note: input.note ?? null,
        takenAt: new Date(),
        takenById: actor.id,
      },
      select: { id: true, code: true },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "tissue_sample",
      summary: `Took tissue sample ${code} (${input.tissue.toLowerCase()}, for ${input.purpose.toLowerCase()} testing)`,
    });
    return sample;
  });
}
