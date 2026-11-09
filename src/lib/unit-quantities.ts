/**
 * The quantities a unit's record reports, read from its events: what it was registered with, what it
 * holds now, what shipped, what was destroyed and the moisture lost in drying. Pure, so it is unit
 * tested; weights are grams, counts are seeds.
 */
export type QuantityState = {
  kind: string;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  shipped: { weight: number | null; moisture: "WET" | "DRY" | null; count: number | null } | null;
  /** On a WASTED event: what was disposed of. */
  wasted?: { weight: number | null; moisture: "WET" | "DRY" | null } | null;
};

export type Amounts = { wet: number | null; dry: number | null; seeds: number | null };

export type UnitQuantities = {
  registered: Amounts;
  /** What the unit holds now; null once it was destroyed. */
  current: Amounts | null;
  shipped: { wet: number; dry: number; seeds: number; shipments: number };
  /** What the unit held when it was destroyed. */
  destroyed: Amounts | null;
  /** What was disposed of as waste along the way, in grams. */
  waste: { wet: number; dry: number; entries: number };
  /** The wet weight when a dry weight was first recorded, that dry weight and the difference. */
  drying: { wet: number; dry: number; loss: number; share: number } | null;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const amountsOf = (state: QuantityState | undefined): Amounts => ({
  wet: state?.humidWeight ?? null,
  dry: state?.dryWeight ?? null,
  seeds: state?.seedCount ?? null,
});

/** `states` oldest first. Every event carries the unit's weights and count after it. */
export function summarizeUnitQuantities(states: readonly QuantityState[]): UnitQuantities {
  const last = states[states.length - 1];
  const shipped = { wet: 0, dry: 0, seeds: 0, shipments: 0 };
  for (const state of states) {
    if (!state.shipped) continue;
    shipped.shipments += 1;
    const { weight, moisture, count } = state.shipped;
    if (weight !== null && moisture === "WET") shipped.wet = round3(shipped.wet + weight);
    if (weight !== null && moisture === "DRY") shipped.dry = round3(shipped.dry + weight);
    if (count !== null) shipped.seeds += count;
  }

  const waste = { wet: 0, dry: 0, entries: 0 };
  for (const state of states) {
    if (!state.wasted || state.wasted.weight === null) continue;
    waste.entries += 1;
    if (state.wasted.moisture === "DRY") waste.dry = round3(waste.dry + state.wasted.weight);
    else waste.wet = round3(waste.wet + state.wasted.weight);
  }

  const firstDry = states.findIndex((state) => state.dryWeight !== null);
  const dryState = states[firstDry];
  const wetAtDrying = dryState?.humidWeight ?? states[firstDry - 1]?.humidWeight ?? null;
  const drying =
    dryState?.dryWeight != null && wetAtDrying !== null && wetAtDrying >= dryState.dryWeight
      ? {
          wet: wetAtDrying,
          dry: dryState.dryWeight,
          loss: round3(wetAtDrying - dryState.dryWeight),
          share: wetAtDrying > 0 ? (wetAtDrying - dryState.dryWeight) / wetAtDrying : 0,
        }
      : null;

  const destroyed = last?.kind === "DESTROYED";
  return {
    registered: amountsOf(states[0]),
    current: destroyed ? null : amountsOf(last),
    shipped,
    destroyed: destroyed ? amountsOf(last) : null,
    waste,
    drying,
  };
}
