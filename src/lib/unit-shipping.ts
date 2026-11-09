import type { Moisture, UnitStateKind } from "@/generated/prisma/enums";

/**
 * What shipping has taken from a unit, read from its events. Shipping is not a status: a unit ships
 * part of itself (flowers by weight on a wet or dry basis, seed lots by count) and stays active with
 * less left. Pure, so it is unit tested; the database reads are in `features/unit/detail-queries.ts`.
 */
export type ShippingState = {
  kind: UnitStateKind;
  /** When the event took effect; only the per-shipment entries use it. */
  at?: Date;
  /** Who received it and on which shipment, when known. */
  organization?: { id: number; name: string } | null;
  shipment?: { id: number; reference: string; materialType: string } | null;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  shippedWeight: number | null;
  shippedMoisture: Moisture | null;
  shippedCount: number | null;
};

/** One measure of the unit: what it held before shipping, what left, what is left. */
export type ShippedMeasure = { original: number | null; shipped: number; left: number | null };

/**
 * One shipment that took something from the unit. `measure` is the stock it came out of; a part of
 * another kind (clones cut from a plant, seeds from a flower) is `part`: it left with the unit named
 * on the line but did not change the unit's own stock, so it has no original or left.
 */
export type ShipmentEntry = {
  at: Date | null;
  organization: { id: number; name: string } | null;
  shipment: { id: number; reference: string } | null;
  materialType: string | null;
  measure: "wet" | "dry" | "seeds" | "part" | "whole";
  original: number | null;
  shipped: number | null;
  left: number | null;
};

export type ShippingSummary = {
  /** How many shipments took something from this unit. */
  shipments: number;
  /** Every shipment, oldest first. */
  entries: ShipmentEntry[];
  wet: ShippedMeasure | null;
  dry: ShippedMeasure | null;
  seeds: ShippedMeasure | null;
  /** Everything that was left has shipped. */
  nothingLeft: boolean;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const isShipment = (state: ShippingState) =>
  state.kind === "SHIPPED_PART" || state.kind === "SHIPPED";

/**
 * `states` oldest first. The "original" of a measure is what the unit held at the last event that was
 * not a shipment, so weighing the unit again after a shipment starts a new original; "shipped" adds
 * every shipment since then.
 */
export function summarizeShipping(states: readonly ShippingState[]): ShippingSummary | null {
  const shipments = states.filter(isShipment).length;
  if (shipments === 0) return null;

  let wet: ShippedMeasure | null = null;
  let dry: ShippedMeasure | null = null;
  let seeds: ShippedMeasure | null = null;
  const entries: ShipmentEntry[] = [];

  states.forEach((state, index) => {
    if (!isShipment(state)) {
      wet = dry = seeds = null;
      return;
    }
    const before = states[index - 1];
    const entry = (
      measure: ShipmentEntry["measure"],
      original: number | null,
      shipped: number | null,
      left: number | null
    ) =>
      entries.push({
        at: state.at ?? null,
        organization: state.organization ?? null,
        shipment: state.shipment
          ? { id: state.shipment.id, reference: state.shipment.reference }
          : null,
        materialType: state.shipment?.materialType ?? null,
        measure,
        original,
        shipped,
        left,
      });
    // A part of another kind leaves the unit's own stock as it was.
    const stockUnchanged =
      state.kind === "SHIPPED_PART" &&
      before !== undefined &&
      before.humidWeight === state.humidWeight &&
      before.dryWeight === state.dryWeight &&
      before.seedCount === state.seedCount;
    if (stockUnchanged) {
      entry("part", null, state.shippedWeight ?? state.shippedCount, null);
      return;
    }
    if (state.shippedWeight !== null && state.shippedMoisture === "WET") {
      entry("wet", before?.humidWeight ?? null, state.shippedWeight, state.humidWeight);
      wet = {
        original: wet?.original ?? before?.humidWeight ?? null,
        shipped: round3((wet?.shipped ?? 0) + state.shippedWeight),
        left: state.humidWeight,
      };
    } else if (state.shippedWeight !== null && state.shippedMoisture === "DRY") {
      entry("dry", before?.dryWeight ?? null, state.shippedWeight, state.dryWeight);
      dry = {
        original: dry?.original ?? before?.dryWeight ?? null,
        shipped: round3((dry?.shipped ?? 0) + state.shippedWeight),
        left: state.dryWeight,
      };
    } else if (state.shippedCount !== null) {
      entry("seeds", before?.seedCount ?? null, state.shippedCount, state.seedCount);
      seeds = {
        original: seeds?.original ?? before?.seedCount ?? null,
        shipped: (seeds?.shipped ?? 0) + state.shippedCount,
        left: state.seedCount,
      };
    } else {
      entry("whole", null, null, null);
    }
  });

  return {
    shipments,
    entries,
    wet,
    dry,
    seeds,
    nothingLeft: states[states.length - 1]?.kind === "SHIPPED",
  };
}
