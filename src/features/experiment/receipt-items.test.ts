import { describe, expect, it } from "vitest";
import { MaterialClass, Measure, Moisture } from "@/generated/prisma/enums";
import type { IntakeGroupInput } from "@/lib/experiment-intake";
import { buildIntakeReceiptItems, type CreatedIntakeUnit } from "./receipt-items";

const group = (over: Partial<IntakeGroupInput>): IntakeGroupInput => ({
  kind: "CLONES",
  cultivarId: 1,
  quantity: 1,
  statusMode: "SAME",
  ...over,
});

const unit = (n: number, type = "PLANT"): CreatedIntakeUnit => ({
  unitId: n,
  stateId: 100 + n,
  name: `AB1-00${n}`,
  type,
  cultivarId: 1,
});

describe("buildIntakeReceiptItems", () => {
  it("makes one count line per unit, linked to the unit and its first state", () => {
    const items = buildIntakeReceiptItems([group({ quantity: 2 })], [unit(1), unit(2)]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      unitId: 1,
      stateId: 101,
      materialType: MaterialClass.CLONE,
      measure: Measure.COUNT,
      unitCount: 1,
      weightGrams: null,
      moisture: null,
    });
  });

  it("books flower by weight with an explicit wet/dry basis", () => {
    const [item] = buildIntakeReceiptItems(
      [group({ kind: "FLOWERS", wetWeightGrams: 120.5 })],
      [unit(1, "FLOWER")]
    );
    expect(item).toMatchObject({
      materialType: MaterialClass.FLOWER,
      measure: Measure.WEIGHT,
      unitCount: null,
      weightGrams: 120.5,
      moisture: Moisture.WET,
    });
    const [dry] = buildIntakeReceiptItems(
      [group({ kind: "FLOWERS", dryWeightGrams: 30 })],
      [unit(1, "FLOWER")]
    );
    expect(dry?.moisture).toBe(Moisture.DRY);
  });

  it("walks several groups in order and notes seed counts", () => {
    const items = buildIntakeReceiptItems(
      [
        group({ kind: "SEEDS", quantity: 1, seedsPerLot: 250 }),
        group({ kind: "PLANTS", quantity: 1 }),
      ],
      [unit(1, "SEEDLOT"), unit(2)]
    );
    expect(items.map((i) => i.materialType)).toEqual([MaterialClass.SEED, MaterialClass.PLANT]);
    expect(items[0]?.comment).toBe("250 seeds/lot");
  });

  it("skips groups with an unknown kind and tolerates fewer units than planned", () => {
    expect(buildIntakeReceiptItems([group({ kind: "NOPE" })], [unit(1)])).toEqual([]);
    expect(buildIntakeReceiptItems([group({ quantity: 3 })], [unit(1)])).toHaveLength(1);
  });
});
