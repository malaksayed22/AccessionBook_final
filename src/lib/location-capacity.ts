/**
 * What a location's capacity counts: units, plants (every plant of a group), or grams of weighed
 * material, taken at the dry weight once one is recorded and the wet weight before (the basis the
 * CTLS return uses).
 */
export type CapacityMeasure = "UNITS" | "PLANTS" | "WEIGHT";

export type LocationCapacityInfo = {
  id: number;
  name: string;
  capacity: number | null;
  capacityMeasure?: CapacityMeasure;
  /** What is stored now, in the same measure. */
  occupancy: number;
};

/** What arrives, in every measure; the location's measure picks one. */
export type Incoming = { units: number; plants: number; grams?: number };

/** The weight a unit counts for: its dry weight once recorded, else its wet weight, else nothing. */
export function countedGrams(weights: {
  dryWeight?: number | null;
  humidWeight?: number | null;
}): number {
  return weights.dryWeight ?? weights.humidWeight ?? 0;
}

/** `52400` → `52.4 kg`, for the English messages a refusal carries. */
function kilograms(grams: number) {
  return `${Number((grams / 1000).toFixed(3))} kg`;
}

export function assessLocationCapacity(
  location: LocationCapacityInfo | null | undefined,
  incoming: number | Incoming
): { ok: boolean; message: string | null } {
  if (!location?.capacity || location.capacity <= 0) {
    return { ok: true, message: null };
  }
  const measure = location.capacityMeasure ?? "UNITS";
  const arriving =
    typeof incoming === "number"
      ? incoming
      : measure === "PLANTS"
        ? incoming.plants
        : measure === "WEIGHT"
          ? (incoming.grams ?? 0)
          : incoming.units;
  const amount = (value: number) =>
    measure === "WEIGHT"
      ? kilograms(value)
      : `${value} ${measure === "PLANTS" ? "plants" : "units"}`;
  const projected = location.occupancy + arriving;
  if (projected <= location.capacity) {
    const remaining = location.capacity - projected;
    return {
      ok: true,
      message:
        remaining === 0
          ? `${location.name} will be at full capacity (${amount(location.capacity)}).`
          : `${location.name}: ${amount(projected)} of ${amount(location.capacity)} after intake (${amount(remaining)} left).`,
    };
  }
  return {
    ok: false,
    message: `${location.name} capacity exceeded: ${amount(projected)} planned but capacity is ${amount(location.capacity)} (currently ${amount(location.occupancy)} stored).`,
  };
}

// --- Display logic (no text: the UI translates the level) -------------------------------------

/** How full a location is. `unlimited` means no capacity is set, so there is nothing to compare. */
export type OccupancyLevel = "unlimited" | "ok" | "near" | "full" | "over";

/** From this share of the capacity a location is flagged as nearly full. */
export const NEAR_CAPACITY_RATIO = 0.9;

function hasLimit(capacity: number | null | undefined): capacity is number {
  return typeof capacity === "number" && capacity > 0;
}

export function occupancyLevel(units: number, capacity: number | null | undefined): OccupancyLevel {
  if (!hasLimit(capacity)) return "unlimited";
  if (units > capacity) return "over";
  if (units === capacity) return "full";
  return units / capacity >= NEAR_CAPACITY_RATIO ? "near" : "ok";
}

/** Whole-number percentage of the capacity in use (may exceed 100), or null without a limit. */
export function occupancyPercent(units: number, capacity: number | null | undefined) {
  return hasLimit(capacity) ? Math.round((units / capacity) * 100) : null;
}

/** A location can be retired only when no unit in inventory is stored there. */
export function canRetireLocation(unitsInside: number): boolean {
  return unitsInside === 0;
}
