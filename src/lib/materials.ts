/**
 * Material accounting rules for inbound receipts and outbound shipments.
 *
 * Health Canada reconciles propagative material (seeds, clones/plants) by unit
 * count and harvested cannabis by gram weight. Weight must always carry an
 * explicit wet/dry basis because the two are not interchangeable in a CTLS
 * return — fresh and dried cannabis are separate reportable classes.
 */

export const SHIPMENT_DIRECTIONS = [
  { id: "INBOUND", label: "Received", verb: "Received from" },
  { id: "OUTBOUND", label: "Shipped", verb: "Shipped to" },
] as const;

export type ShipmentDirection = (typeof SHIPMENT_DIRECTIONS)[number]["id"];

export const SHIPMENT_STATUSES = [
  { id: "DRAFT", label: "Draft", tone: "muted" },
  { id: "IN_TRANSIT", label: "In transit", tone: "warn" },
  { id: "DELIVERED", label: "Delivered", tone: "ok" },
  { id: "CANCELLED", label: "Cancelled", tone: "danger" },
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]["id"];

export type Measure = "COUNT" | "WEIGHT";
export type Moisture = "WET" | "DRY";

export const MOISTURE_OPTIONS = [
  { id: "WET", label: "Wet / fresh" },
  { id: "DRY", label: "Dry" },
] as const;

/**
 * `measure` is the regulatory accounting basis and is not user-selectable —
 * it is fixed per material class so a shipment can never be booked in the
 * wrong unit.
 */
export const MATERIAL_CLASSES = [
  { id: "SEED", label: "Seeds", measure: "COUNT", unitLabel: "seeds" },
  { id: "CLONE", label: "Clones / cuttings", measure: "COUNT", unitLabel: "clones" },
  { id: "PLANT", label: "Whole plants", measure: "COUNT", unitLabel: "plants" },
  { id: "CULTURE", label: "Tissue cultures", measure: "COUNT", unitLabel: "vessels" },
  { id: "FLOWER", label: "Flower / harvested cannabis", measure: "WEIGHT", unitLabel: "g" },
  { id: "TRIM", label: "Trim / by-product", measure: "WEIGHT", unitLabel: "g" },
] as const;

export type MaterialClassId = (typeof MATERIAL_CLASSES)[number]["id"];

const MATERIAL_BY_ID = new Map(MATERIAL_CLASSES.map((m) => [m.id, m]));

export function getMaterialClass(id: string) {
  return MATERIAL_BY_ID.get(id as MaterialClassId) ?? null;
}

export function measureForMaterial(id: string): Measure {
  return (getMaterialClass(id)?.measure ?? "COUNT") as Measure;
}

export function isWeightBased(id: string): boolean {
  return measureForMaterial(id) === "WEIGHT";
}

/** Maps a biological unit type onto its default material class. */
export function materialClassForUnitType(unitType: string): MaterialClassId {
  switch (unitType) {
    case "SEEDLOT":
      return "SEED";
    case "FLOWER":
      return "FLOWER";
    case "CULTURE":
      return "CULTURE";
    default:
      return "PLANT";
  }
}

export type QuantityInput = {
  materialType: string;
  unitCount?: number | null;
  weightGrams?: number | null;
  moisture?: string | null;
};

/**
 * Renders a line quantity the way it must appear on a manifest:
 * counts stay whole, weights carry grams plus the wet/dry basis.
 */
export function formatQuantity(item: QuantityInput): string {
  const material = getMaterialClass(item.materialType);
  const unitLabel = material?.unitLabel ?? "units";

  if (isWeightBased(item.materialType)) {
    if (item.weightGrams == null) return "—";
    const basis = item.moisture === "WET" ? "wet" : item.moisture === "DRY" ? "dry" : null;
    return `${formatGrams(item.weightGrams)} g${basis ? ` (${basis})` : ""}`;
  }

  if (item.unitCount == null) return "—";
  return `${item.unitCount.toLocaleString("en-CA")} ${unitLabel}`;
}

export function formatGrams(value: number): string {
  return value.toLocaleString("en-CA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Rejects lines booked in the wrong accounting basis before they reach the DB. */
export function validateShipmentItem(item: QuantityInput): ValidationResult {
  const material = getMaterialClass(item.materialType);
  if (!material) return { ok: false, error: `Unknown material type "${item.materialType}"` };

  if (material.measure === "WEIGHT") {
    if (item.weightGrams == null || Number.isNaN(item.weightGrams)) {
      return { ok: false, error: `${material.label} must be recorded in grams` };
    }
    if (item.weightGrams < 0) return { ok: false, error: "Weight cannot be negative" };
    if (item.moisture !== "WET" && item.moisture !== "DRY") {
      return { ok: false, error: `${material.label} requires a wet or dry basis` };
    }
    return { ok: true };
  }

  if (item.unitCount == null || Number.isNaN(item.unitCount)) {
    return { ok: false, error: `${material.label} must be recorded as a unit count` };
  }
  if (!Number.isInteger(item.unitCount)) {
    return { ok: false, error: `${material.label} count must be a whole number` };
  }
  if (item.unitCount < 0) return { ok: false, error: "Count cannot be negative" };
  return { ok: true };
}

export type MaterialTotals = {
  seeds: number;
  clones: number;
  plants: number;
  cultures: number;
  wetGrams: number;
  dryGrams: number;
};

export function emptyTotals(): MaterialTotals {
  return { seeds: 0, clones: 0, plants: 0, cultures: 0, wetGrams: 0, dryGrams: 0 };
}

/** Aggregates lines into the buckets a CTLS return expects. */
export function sumMaterials(items: QuantityInput[]): MaterialTotals {
  const totals = emptyTotals();

  for (const item of items) {
    if (isWeightBased(item.materialType)) {
      const grams = item.weightGrams ?? 0;
      if (item.moisture === "WET") totals.wetGrams += grams;
      else totals.dryGrams += grams;
      continue;
    }

    const count = item.unitCount ?? 0;
    switch (item.materialType) {
      case "SEED":
        totals.seeds += count;
        break;
      case "CLONE":
        totals.clones += count;
        break;
      case "CULTURE":
        totals.cultures += count;
        break;
      default:
        totals.plants += count;
    }
  }

  return totals;
}

export function summarizeTotals(totals: MaterialTotals): string {
  const parts: string[] = [];
  if (totals.seeds) parts.push(`${totals.seeds.toLocaleString("en-CA")} seeds`);
  if (totals.clones) parts.push(`${totals.clones.toLocaleString("en-CA")} clones`);
  if (totals.plants) parts.push(`${totals.plants.toLocaleString("en-CA")} plants`);
  if (totals.cultures) parts.push(`${totals.cultures.toLocaleString("en-CA")} cultures`);
  if (totals.wetGrams) parts.push(`${formatGrams(totals.wetGrams)} g wet`);
  if (totals.dryGrams) parts.push(`${formatGrams(totals.dryGrams)} g dry`);
  return parts.length ? parts.join(" · ") : "No material recorded";
}

/** Human-readable, collision-resistant manifest reference. */
export function buildShipmentReference(direction: ShipmentDirection, date = new Date()): string {
  const prefix = direction === "INBOUND" ? "RCV" : "SHP";
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}
