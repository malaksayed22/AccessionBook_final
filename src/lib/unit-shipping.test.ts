import { describe, expect, it } from "vitest";
import { summarizeShipping, type ShippingState } from "./unit-shipping";

const base: ShippingState = {
  kind: "MEASURED",
  humidWeight: null,
  dryWeight: null,
  seedCount: null,
  shippedWeight: null,
  shippedMoisture: null,
  shippedCount: null,
};
const state = (patch: Partial<ShippingState>): ShippingState => ({ ...base, ...patch });

describe("summarizeShipping", () => {
  it("is null for a unit nothing has shipped from", () => {
    expect(summarizeShipping([state({ kind: "CREATED" }), state({ humidWeight: 10 })])).toBeNull();
  });

  it("reads original, shipped so far and left for a flower shipped in two parts", () => {
    const summary = summarizeShipping([
      state({ kind: "CREATED", humidWeight: 100, dryWeight: 25 }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 70,
        dryWeight: 25,
        shippedWeight: 30,
        shippedMoisture: "WET",
      }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 45.5,
        dryWeight: 25,
        shippedWeight: 24.5,
        shippedMoisture: "WET",
      }),
    ]);
    expect(summary).toMatchObject({
      shipments: 2,
      nothingLeft: false,
      wet: { original: 100, shipped: 54.5, left: 45.5 },
      dry: null,
      seeds: null,
    });
  });

  it("keeps the dry and wet measures apart", () => {
    const summary = summarizeShipping([
      state({ kind: "CREATED", humidWeight: 100, dryWeight: 20 }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 100,
        dryWeight: 15,
        shippedWeight: 5,
        shippedMoisture: "DRY",
      }),
    ]);
    expect(summary?.dry).toEqual({ original: 20, shipped: 5, left: 15 });
    expect(summary?.wet).toBeNull();
  });

  it("starts a new original when the unit is weighed again after shipping", () => {
    const summary = summarizeShipping([
      state({ kind: "CREATED", humidWeight: 100 }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 60,
        shippedWeight: 40,
        shippedMoisture: "WET",
      }),
      state({ kind: "MEASURED", humidWeight: 58 }),
      state({
        kind: "SHIPPED_PART",
        humidWeight: 48,
        shippedWeight: 10,
        shippedMoisture: "WET",
      }),
    ]);
    expect(summary?.shipments).toBe(2);
    expect(summary?.wet).toEqual({ original: 58, shipped: 10, left: 48 });
  });

  it("counts seeds and marks the unit when the last shipment took everything", () => {
    const summary = summarizeShipping([
      state({ kind: "CREATED", seedCount: 50 }),
      state({ kind: "SHIPPED_PART", seedCount: 20, shippedCount: 30 }),
      state({ kind: "SHIPPED", seedCount: 0, shippedCount: 20 }),
    ]);
    expect(summary).toMatchObject({
      nothingLeft: true,
      seeds: { original: 50, shipped: 50, left: 0 },
    });
  });

  it("counts a whole shipment with no quantity (a plant, or imported data)", () => {
    const summary = summarizeShipping([state({ kind: "CREATED" }), state({ kind: "SHIPPED" })]);
    expect(summary).toMatchObject({ shipments: 1, nothingLeft: true, wet: null, seeds: null });
  });

  it("lists every shipment with what it took and what was left after it", () => {
    const summary = summarizeShipping([
      state({ kind: "CREATED", dryWeight: 50 }),
      state({
        kind: "SHIPPED_PART",
        at: new Date("2026-10-01"),
        organization: { id: 7, name: "Quebec Analytical Services" },
        shipment: { id: 3, reference: "OUT-3", materialType: "FLOWER" },
        dryWeight: 30,
        shippedWeight: 20,
        shippedMoisture: "DRY",
      }),
      state({ kind: "SHIPPED", dryWeight: 0, shippedWeight: 30, shippedMoisture: "DRY" }),
    ]);
    expect(summary?.entries).toEqual([
      expect.objectContaining({
        measure: "dry",
        original: 50,
        shipped: 20,
        left: 30,
        shipment: { id: 3, reference: "OUT-3" },
        organization: { id: 7, name: "Quebec Analytical Services" },
      }),
      expect.objectContaining({ measure: "dry", original: 30, shipped: 30, left: 0 }),
    ]);
  });

  it("lists a part of another kind without touching the unit's stock", () => {
    const summary = summarizeShipping([
      state({ kind: "CREATED", seedCount: null }),
      state({
        kind: "SHIPPED_PART",
        shippedCount: 5,
        shipment: { id: 4, reference: "OUT-4", materialType: "CLONE" },
      }),
    ]);
    expect(summary?.entries[0]).toMatchObject({
      measure: "part",
      materialType: "CLONE",
      shipped: 5,
      original: null,
      left: null,
    });
    expect(summary?.seeds).toBeNull();
  });
});
