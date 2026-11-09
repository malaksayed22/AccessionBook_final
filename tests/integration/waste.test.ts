import { beforeEach, describe, expect, it } from "vitest";
import { GrowthStage, HoldKind, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import { listWasteEntries } from "@/features/qa/queries";
import { placeHold } from "@/features/qa/service";
import { getUnitStates } from "@/features/unit/queries";
import { recordWaste } from "@/features/unit/waste";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

const waste = { type: "TRIM" as const, method: "Mixed with cat litter, then composted" };

describe("waste", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const freshFlower = () =>
    registerOne(lab, {
      name: "FRESH-1",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 500,
    } as never);

  it("disposes of part of a fresh flower by wet weight, and lists it in the register", async () => {
    const unit = await freshFlower();
    const result = await recordWaste(lab.member, unit.id, { ...waste, amount: 30 });
    expect(result.left).toBe(470);

    const last = (await getUnitStates(lab.member, unit.id)).at(-1)!;
    expect(last).toMatchObject({
      kind: UnitStateKind.WASTED,
      humidWeight: 470,
      reason: waste.method,
    });
    expect(last.wasted).toEqual({ weight: 30, moisture: "WET", type: "TRIM" });

    const register = await listWasteEntries(lab.member, {});
    expect(register.total).toBe(1);
    expect(register.rows[0]).toMatchObject({
      unitName: "FRESH-1",
      type: "TRIM",
      grams: 30,
      moisture: "WET",
      method: waste.method,
      actor: "Member",
    });
    expect(await prisma.auditLog.count({ where: { action: "waste" } })).toBe(1);
    // The register follows the read scope.
    expect((await listWasteEntries(lab.outsider, {})).total).toBe(0);
  });

  it("disposes of a harvested plant's stems by dry weight once dried", async () => {
    const plant = await registerOne(lab, {
      name: "PLANT-H",
      growthStage: GrowthStage.CURING,
      humidWeight: 900,
      dryWeight: 200,
    } as never);
    await recordWaste(lab.member, plant.id, { ...waste, type: "STEMS_LEAVES", amount: 12.5 });
    const last = (await getUnitStates(lab.member, plant.id)).at(-1)!;
    expect(last).toMatchObject({ dryWeight: 187.5, humidWeight: 900 });
  });

  it("refuses waste on a held unit, a living plant, or all of a unit", async () => {
    const unit = await freshFlower();
    expect(
      (await failure(recordWaste(lab.member, unit.id, { ...waste, amount: 500 }))).details
    ).toMatchObject({
      reason: "wasteTooLarge",
    });

    const living = await registerOne(lab, { name: "VEG-1" });
    expect(
      (await failure(recordWaste(lab.member, living.id, { ...waste, amount: 1 }))).details
    ).toMatchObject({
      reason: "wasteNotApplicable",
    });

    await placeHold(lab.member, unit.id, { kind: HoldKind.HOLD, reason: "Under review" });
    expect((await failure(recordWaste(lab.member, unit.id, { ...waste, amount: 1 }))).code).toBe(
      "UNIT_ON_HOLD"
    );
    expect(await prisma.unitState.count({ where: { kind: UnitStateKind.WASTED } })).toBe(0);
  });
});
