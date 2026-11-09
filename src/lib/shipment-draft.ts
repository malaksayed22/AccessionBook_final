import { isWeightBased } from "./materials";

/**
 * The shipment form's lines before they are sent. Pure, so the rules are unit tested and the form
 * only has to translate a problem into a sentence (this file holds no display text).
 */
export type LineDraft = {
  key: number;
  description: string;
  materialType: string;
  unitCount: string;
  weightGrams: string;
  moisture: string;
  cultivarId: string;
  /** Set when the line comes from a unit in inventory; the unit then leaves with the shipment. */
  unitId: string;
  unitName: string;
  /**
   * A unit's line ships all that is left of the unit, or a part of it (an amount of its own material,
   * or a part of another kind such as clones from a plant). Empty for lines that are not a unit.
   */
  shipMode: ShipMode | "";
  comment: string;
};

export type ShipMode = "all" | "part";

export type LineProblem =
  | "description"
  | "countMissing"
  | "countNotWhole"
  | "weightMissing"
  | "negative"
  | "basisMissing"
  | "needsUnit"
  | "materialMissing";

/** Material that leaves on an outbound shipment without being a unit (it is not tracked as one). */
export const FREE_OUTBOUND_MATERIAL = "TRIM";

export function emptyLine(key: number, materialType = "SEED"): LineDraft {
  return {
    key,
    description: "",
    materialType,
    unitCount: "",
    weightGrams: "",
    moisture: "",
    cultivarId: "",
    unitId: "",
    unitName: "",
    shipMode: "",
    comment: "",
  };
}

/** The unit kinds a shipment line can come from. */
export type ShippableType = "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE";

/**
 * What a part of a unit can be. Seeds, clones or cuttings and tissue cultures are counted; flower and
 * trim are weighed (Health Canada tracks propagation material by number and cannabis by weight). A
 * plant gives clones, tissue and seeds, and flower or trim once it was harvested and weighed; a flower
 * gives flower, trim and seeds; a seed lot gives seeds. A culture ships whole.
 */
export function partMaterials(type: ShippableType, weighed: boolean): readonly string[] {
  switch (type) {
    case "PLANT":
      return weighed
        ? ["CLONE", "CULTURE", "SEED", "FLOWER", "TRIM"]
        : ["CLONE", "CULTURE", "SEED"];
    case "FLOWER":
      return ["FLOWER", "TRIM", "SEED"];
    case "SEEDLOT":
      return ["SEED"];
    default:
      return [];
  }
}

/**
 * The first thing wrong with a line, or null. Counts are whole numbers; weights carry a wet or dry
 * basis. On an outbound shipment every line except trim is a unit from inventory, so stock goes down.
 */
export function lineProblem(line: LineDraft, outbound = false): LineProblem | null {
  if (outbound && !line.unitId && line.materialType !== FREE_OUTBOUND_MATERIAL) return "needsUnit";
  if (!line.description.trim()) return "description";
  if (line.shipMode === "part" && !line.materialType) return "materialMissing";

  if (isWeightBased(line.materialType)) {
    if (line.weightGrams.trim() === "" || Number.isNaN(Number(line.weightGrams))) {
      return "weightMissing";
    }
    if (Number(line.weightGrams) < 0) return "negative";
    if (line.moisture !== "WET" && line.moisture !== "DRY") return "basisMissing";
    return null;
  }

  if (line.unitCount.trim() === "" || Number.isNaN(Number(line.unitCount))) return "countMissing";
  if (Number(line.unitCount) < 0) return "negative";
  if (!Number.isInteger(Number(line.unitCount))) return "countNotWhole";
  return null;
}

/** Problems by line key; an empty object means the lines can be sent. */
export function lineProblems(lines: LineDraft[], outbound = false): Record<number, LineProblem> {
  const out: Record<number, LineProblem> = {};
  for (const line of lines) {
    const problem = lineProblem(line, outbound);
    if (problem) out[line.key] = problem;
  }
  return out;
}

/** What the API expects for one line: counts and weights are numbers only for the basis they use. */
export function linePayload(line: LineDraft) {
  const weighed = isWeightBased(line.materialType);
  return {
    description: line.description.trim(),
    materialType: line.materialType,
    unitCount: !weighed && line.unitCount.trim() !== "" ? Number(line.unitCount) : null,
    weightGrams: weighed && line.weightGrams.trim() !== "" ? Number(line.weightGrams) : null,
    moisture: weighed ? line.moisture : null,
    cultivarId: line.cultivarId ? Number(line.cultivarId) : null,
    unitId: line.unitId ? Number(line.unitId) : null,
    isPart: line.unitId ? line.shipMode === "part" : undefined,
    comment: line.comment.trim() || null,
  };
}

/** The same line as the totals line wants it. */
export function lineQuantity(line: LineDraft) {
  return {
    materialType: line.materialType,
    unitCount: line.unitCount.trim() === "" ? null : Number(line.unitCount),
    weightGrams: line.weightGrams.trim() === "" ? null : Number(line.weightGrams),
    moisture: line.moisture || null,
  };
}
