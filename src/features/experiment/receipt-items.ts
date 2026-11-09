import { MaterialClass, Measure, Moisture } from "@/generated/prisma/enums";
import { findIntakeKind, type IntakeGroupInput } from "@/lib/experiment-intake";
import { measureForMaterial } from "@/lib/materials";

export type CreatedIntakeUnit = {
  unitId: number;
  stateId: number;
  name: string;
  type: string;
  cultivarId: number;
};

/** Wording of the receipt line, stored with the record (like audit summaries it is not translated). */
const RECEIPT_LINE_LABEL: Record<string, string> = {
  SEEDS: "Seeds",
  CLONES: "Clones / cuttings",
  PLANTS: "Plants (seedlings, mothers)",
  CULTURES: "Tissue cultures",
  FLOWERS: "Harvested flower",
};

function materialFor(kindId: string, unitType: string): MaterialClass {
  switch (kindId) {
    case "SEEDS":
      return MaterialClass.SEED;
    case "CLONES":
      return MaterialClass.CLONE;
    case "CULTURES":
      return MaterialClass.CULTURE;
    case "FLOWERS":
      return MaterialClass.FLOWER;
    default:
      return unitType === "FLOWER" ? MaterialClass.FLOWER : MaterialClass.PLANT;
  }
}

function moistureFor(wet?: number | null, dry?: number | null): Moisture | null {
  if (wet != null && wet > 0) return Moisture.WET;
  if (dry != null && dry > 0) return Moisture.DRY;
  return null;
}

/**
 * One receipt line per registered unit, linked to the unit's first (RECEIVED) state, so inbound
 * custody stays one-to-one with inventory.
 */
export function buildIntakeReceiptItems(
  groups: IntakeGroupInput[],
  createdUnits: CreatedIntakeUnit[]
) {
  let cursor = 0;
  const items: Array<{
    unitId: number;
    stateId: number;
    cultivarId: number;
    description: string;
    materialType: MaterialClass;
    measure: Measure;
    unitCount: number | null;
    weightGrams: number | null;
    moisture: Moisture | null;
    comment: string | null;
  }> = [];

  for (const group of groups) {
    const kind = findIntakeKind(group.kind);
    if (!kind) continue;
    const weighed = !!kind.tracksWeight;

    for (let i = 0; i < group.quantity; i += 1) {
      const unit = createdUnits[cursor + i];
      if (!unit) continue;
      const materialType = materialFor(group.kind, unit.type);
      items.push({
        unitId: unit.unitId,
        stateId: unit.stateId,
        cultivarId: unit.cultivarId,
        description: `${unit.name} — ${RECEIPT_LINE_LABEL[kind.id] ?? kind.id} intake`,
        materialType,
        measure: measureForMaterial(materialType) as Measure,
        unitCount: weighed ? null : 1,
        weightGrams: weighed ? (group.wetWeightGrams ?? group.dryWeightGrams ?? null) : null,
        moisture: weighed ? moistureFor(group.wetWeightGrams, group.dryWeightGrams) : null,
        comment: group.seedsPerLot ? `${group.seedsPerLot} seeds/lot` : null,
      });
    }
    cursor += group.quantity;
  }
  return items;
}
