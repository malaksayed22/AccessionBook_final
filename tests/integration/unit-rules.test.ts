import { beforeEach, describe, expect, it } from "vitest";
import {
  GrowthStage,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
  UnitType,
} from "@/generated/prisma/enums";
import { createShipment } from "@/features/shipment/service";
import { changeStage, measureUnit } from "@/features/unit/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase, statesOf } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;
type ShipmentInput = Parameters<typeof createShipment>[1];

/** The rules the team lead set for units on 2026-11-04: stages, weights and shipping a part. */
describe("unit rules", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const ship = (items: ShipmentInput["items"]) =>
    createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: lab.provider.id,
      status: ShipmentStatus.IN_TRANSIT,
      items,
    } as ShipmentInput);

  it("moves stages forward only", async () => {
    const plant = await registerOne(lab, { growthStage: GrowthStage.FLOWERING });
    await expect(
      changeStage(lab.member, plant.id, { toStage: GrowthStage.VEGETATIVE })
    ).rejects.toMatchObject({ details: { reason: "stageBackward" } });
    await changeStage(lab.member, plant.id, { toStage: GrowthStage.HARVESTED });
  });

  it("keeps a recorded weight from members; an administrator corrects it, saying why", async () => {
    const flower = await registerOne(lab, {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 100,
    } as never);
    // The dry weight is still missing, so a member adds it.
    await measureUnit(lab.member, flower.id, { dryWeight: 25 });
    await expect(measureUnit(lab.member, flower.id, { dryWeight: 24 })).rejects.toMatchObject({
      details: { reason: "weightRecorded" },
    });
    await expect(measureUnit(lab.admin, flower.id, { dryWeight: 24 })).rejects.toMatchObject({
      details: { reason: "correctionReason" },
    });
    await measureUnit(lab.admin, flower.id, { dryWeight: 24, comment: "Scale was off by 1 g" });
  });

  it("ships clones cut from a plant as a part: the plant stays active and unchanged", async () => {
    const mother = await registerOne(lab, { name: "Mother" });
    await ship([
      {
        unitId: mother.id,
        description: "Five clones of Mother",
        materialType: MaterialClass.CLONE,
        unitCount: 5,
        isPart: true,
      },
    ]);
    const states = await statesOf(mother.id);
    expect(states.at(-1)).toMatchObject({ kind: "SHIPPED_PART", shippedCount: 5 });
  });

  it("ships all of a clone unit as a whole, as before", async () => {
    const clone = await registerOne(lab, { name: "Clone" });
    await ship([
      {
        unitId: clone.id,
        description: "Clone",
        materialType: MaterialClass.CLONE,
        unitCount: 1,
      },
    ]);
    expect((await statesOf(clone.id)).at(-1)?.kind).toBe("SHIPPED");
  });

  it("ships trim out of a flower's weight", async () => {
    const flower = await registerOne(lab, {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 100,
      dryWeight: 30,
    } as never);
    await ship([
      {
        unitId: flower.id,
        description: "Trim of the flower",
        materialType: MaterialClass.TRIM,
        weightGrams: 5,
        moisture: "DRY",
        isPart: true,
      },
    ]);
    const last = (await statesOf(flower.id)).at(-1);
    expect(last?.kind).toBe("SHIPPED_PART");
    expect(Number(last?.dryWeight)).toBe(25);
    expect(await prisma.shipmentItem.count({ where: { unitId: flower.id, isPart: true } })).toBe(1);
  });

  it("ships several parts of one unit on one shipment, one after the other", async () => {
    const flower = await registerOne(lab, {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 100,
      dryWeight: 40,
    } as never);
    const part = (materialType: MaterialClass, weightGrams: number) => ({
      unitId: flower.id,
      description: "Part of the flower",
      materialType,
      weightGrams,
      moisture: "DRY" as const,
      isPart: true,
    });
    // The same material may come twice, with a different amount.
    await ship([
      part(MaterialClass.FLOWER, 10),
      part(MaterialClass.FLOWER, 3),
      part(MaterialClass.TRIM, 2),
    ]);
    const states = await statesOf(flower.id);
    expect(Number(states.at(-1)?.dryWeight)).toBe(25);
    expect(states.filter((s) => s.kind === "SHIPPED_PART")).toHaveLength(3);
  });

  it("still refuses a unit twice when all of it ships", async () => {
    const plant = await registerOne(lab, { name: "Twice" });
    const whole = {
      unitId: plant.id,
      description: "Twice",
      materialType: MaterialClass.PLANT,
      unitCount: 1,
    };
    await expect(ship([whole, whole])).rejects.toThrow(/only once/);
  });
});
