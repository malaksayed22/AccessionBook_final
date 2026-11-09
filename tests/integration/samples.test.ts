import { beforeEach, describe, expect, it } from "vitest";
import { GrowthStage, HoldKind, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import { placeHold } from "@/features/qa/service";
import { getUnitProfile, getUnitQuality, getUnitStates } from "@/features/unit/queries";
import { takeSample } from "@/features/unit/samples";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { asActor, createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("samples", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const driedFlower = () =>
    registerOne(lab, {
      name: "LOT-1",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.CURING,
      humidWeight: 500,
      dryWeight: 100,
    } as never);

  it("takes part of a dried flower by dry weight, as a unit of its own linked to its parent", async () => {
    const parent = await driedFlower();
    const result = await takeSample(lab.member, parent.id, { kind: "RELEASE", amount: 2.5 });
    expect(result.sample.name).toBe("LOT-1-S-1");

    const states = await getUnitStates(lab.member, parent.id);
    const last = states.at(-1)!;
    expect(last).toMatchObject({ kind: UnitStateKind.SAMPLED, dryWeight: 97.5, humidWeight: 500 });
    expect(last.sampled).toEqual({ weight: 2.5, moisture: "DRY", count: null });

    const sample = await prisma.biologicalUnit.findUniqueOrThrow({
      where: { id: result.sample.id },
      include: { currentState: true },
    });
    expect(sample).toMatchObject({
      type: UnitType.FLOWER,
      sampleKind: "RELEASE",
      sourceParentUnitId: parent.id,
      experimentId: lab.experiment.id,
      cultivarId: lab.cultivar.id,
    });
    expect(Number(sample.currentState?.dryWeight)).toBe(2.5);
    expect(sample.currentState?.humidWeight).toBeNull();
    expect(sample.currentState?.parentStateId).toBe(last.id);
    expect((await getUnitProfile(lab.member, sample.id))?.sampleKind).toBe("RELEASE");

    // The parent lists its samples; a second one takes the next number.
    await takeSample(lab.member, parent.id, { kind: "RETENTION", amount: 1 });
    const quality = await getUnitQuality(lab.member, parent.id);
    expect(quality.samples.map((s) => [s.name, s.kind, s.dry, s.tests])).toEqual([
      ["LOT-1-S-2", "RETENTION", 1, 0],
      ["LOT-1-S-1", "RELEASE", 2.5, 0],
    ]);
    const audits = await prisma.auditLog.findMany({
      where: { action: { in: ["sample", "sample_parent"] } },
    });
    expect(audits).toHaveLength(4);
  });

  it("samples a seed lot by count, and a held lot too, by quality assurance", async () => {
    const seeds = await registerOne(lab, {
      name: "SEEDS-1",
      type: UnitType.SEEDLOT,
      seedCount: 200,
      growthStage: undefined,
    } as never);
    await placeHold(lab.member, seeds.id, { kind: HoldKind.HOLD, reason: "Germination check" });
    const qa = asActor(
      await prisma.user.create({ data: { name: "QA", email: "qa@example.com", permissions: "QA" } })
    );
    const result = await takeSample(qa, seeds.id, { kind: "INTERNAL_QA", amount: 20 });
    const parentState = (await getUnitStates(qa, seeds.id)).at(-1)!;
    expect(parentState).toMatchObject({ kind: UnitStateKind.SAMPLED, seedCount: 180 });
    const sample = await prisma.biologicalUnit.findUniqueOrThrow({
      where: { id: result.sample.id },
      include: { currentState: true },
    });
    expect(sample.currentState?.seedCount).toBe(20);
    expect(
      (await failure(takeSample(qa, seeds.id, { kind: "INTERNAL_QA", amount: 2.5 }))).code
    ).toBe("VALIDATION");
  });

  it("refuses a sample of all the unit, of a plant, or by someone who cannot change the unit", async () => {
    const parent = await driedFlower();
    const tooLarge = await failure(
      takeSample(lab.member, parent.id, { kind: "RELEASE", amount: 100 })
    );
    expect(tooLarge.details).toMatchObject({ reason: "sampleTooLarge" });

    const plant = await registerOne(lab, { name: "PLANT-1" });
    const notApplicable = await failure(
      takeSample(lab.member, plant.id, { kind: "RELEASE", amount: 1 })
    );
    expect(notApplicable.details).toMatchObject({ reason: "sampleNotApplicable" });

    expect(
      (await failure(takeSample(lab.outsider, parent.id, { kind: "RELEASE", amount: 1 }))).code
    ).toBe("FORBIDDEN");
    expect(await prisma.biologicalUnit.count({ where: { sampleKind: { not: null } } })).toBe(0);
  });
});
