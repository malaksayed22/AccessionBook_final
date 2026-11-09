import { describe, expect, it } from "vitest";
import { summarizeUnitQuantities, type QuantityState } from "./unit-quantities";

const state = (patch: Partial<QuantityState> & { kind: string }): QuantityState => ({
  humidWeight: null,
  dryWeight: null,
  seedCount: null,
  shipped: null,
  ...patch,
});

describe("summarizeUnitQuantities", () => {
  it("reads what a flower was registered with, what dried and what shipped", () => {
    const quantities = summarizeUnitQuantities([
      state({ kind: "CREATED", humidWeight: 500 }),
      state({ kind: "MEASURED", humidWeight: 500, dryWeight: 110.5 }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 500,
        dryWeight: 100.5,
        shipped: { weight: 10, moisture: "DRY", count: null },
      }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 500,
        dryWeight: 90.25,
        shipped: { weight: 10.25, moisture: "DRY", count: null },
      }),
    ]);
    expect(quantities.registered).toEqual({ wet: 500, dry: null, seeds: null });
    expect(quantities.current).toEqual({ wet: 500, dry: 90.25, seeds: null });
    expect(quantities.shipped).toEqual({ wet: 0, dry: 20.25, seeds: 0, shipments: 2 });
    expect(quantities.destroyed).toBeNull();
    expect(quantities.drying).toEqual({ wet: 500, dry: 110.5, loss: 389.5, share: 0.779 });
  });

  it("counts seeds shipped and keeps what a destroyed unit held apart from stock", () => {
    const quantities = summarizeUnitQuantities([
      state({ kind: "RECEIVED", seedCount: 100 }),
      state({
        kind: "SHIPPED_PART",
        seedCount: 70,
        shipped: { weight: null, moisture: null, count: 30 },
      }),
      state({ kind: "DESTROYED", seedCount: 70 }),
    ]);
    expect(quantities.shipped).toEqual({ wet: 0, dry: 0, seeds: 30, shipments: 1 });
    expect(quantities.current).toBeNull();
    expect(quantities.destroyed).toEqual({ wet: null, dry: null, seeds: 70 });
    expect(quantities.drying).toBeNull();
  });

  it("reports no drying loss without a wet weight, or when the dry weight is the heavier", () => {
    expect(summarizeUnitQuantities([state({ kind: "CREATED", dryWeight: 40 })]).drying).toBeNull();
    expect(
      summarizeUnitQuantities([
        state({ kind: "CREATED", humidWeight: 30 }),
        state({ kind: "MEASURED", humidWeight: 30, dryWeight: 40 }),
      ]).drying
    ).toBeNull();
  });

  it("adds up the waste disposed of along the way", () => {
    const quantities = summarizeUnitQuantities([
      state({ kind: "CREATED", humidWeight: 500 }),
      state({ kind: "WASTED", humidWeight: 470, wasted: { weight: 30, moisture: "WET" } }),
      state({ kind: "MEASURED", humidWeight: 470, dryWeight: 100 }),
      state({
        kind: "WASTED",
        humidWeight: 470,
        dryWeight: 95.5,
        wasted: { weight: 4.5, moisture: "DRY" },
      }),
    ]);
    expect(quantities.waste).toEqual({ wet: 30, dry: 4.5, entries: 2 });
  });

  it("is empty for a unit with no events", () => {
    expect(summarizeUnitQuantities([])).toEqual({
      registered: { wet: null, dry: null, seeds: null },
      current: { wet: null, dry: null, seeds: null },
      shipped: { wet: 0, dry: 0, seeds: 0, shipments: 0 },
      destroyed: null,
      waste: { wet: 0, dry: 0, entries: 0 },
      drying: null,
    });
  });
});
