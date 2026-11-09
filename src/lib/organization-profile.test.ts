import { describe, expect, it } from "vitest";
import { nonZeroTotals, relationsOf, totalsFromGroups } from "./organization-profile";

const none = { suppliedUnits: 0, inboundShipments: 0, outboundShipments: 0, labResults: 0 };

describe("relationsOf", () => {
  it("has no relation without records", () => {
    expect(relationsOf(none)).toEqual([]);
  });

  it("is a supplier through units or received shipments, a recipient through sent ones", () => {
    expect(relationsOf({ ...none, suppliedUnits: 1 })).toEqual(["supplier"]);
    expect(relationsOf({ ...none, inboundShipments: 2 })).toEqual(["supplier"]);
    expect(relationsOf({ ...none, outboundShipments: 1 })).toEqual(["recipient"]);
  });

  it("can be several things at once, in a fixed order", () => {
    expect(
      relationsOf({ suppliedUnits: 1, inboundShipments: 1, outboundShipments: 1, labResults: 3 })
    ).toEqual(["supplier", "recipient", "lab"]);
  });
});

describe("totalsFromGroups", () => {
  it("counts propagative material and keeps wet and dry grams apart", () => {
    const totals = totalsFromGroups([
      { materialType: "SEED", unitCount: 100, weightGrams: null, moisture: null },
      { materialType: "CLONE", unitCount: 5 },
      { materialType: "FLOWER", weightGrams: 10.5, moisture: "WET" },
      { materialType: "FLOWER", weightGrams: 2, moisture: "DRY" },
    ]);
    expect(totals).toMatchObject({ seeds: 100, clones: 5, wetGrams: 10.5, dryGrams: 2 });
  });

  it("is all zeros for no material", () => {
    expect(nonZeroTotals(totalsFromGroups([]))).toEqual([]);
  });
});

describe("nonZeroTotals", () => {
  it("lists only what moved, in a fixed order", () => {
    const totals = totalsFromGroups([
      { materialType: "FLOWER", weightGrams: 3, moisture: "DRY" },
      { materialType: "SEED", unitCount: 7 },
    ]);
    expect(nonZeroTotals(totals)).toEqual([
      { key: "seeds", value: 7 },
      { key: "dryGrams", value: 3 },
    ]);
  });
});
