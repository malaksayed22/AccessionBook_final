import { describe, expect, it } from "vitest";
import {
  deriveMaterialClass,
  summarizeWeights,
  terminalKindOf,
  unitStatusOf,
  type WeightedState,
} from "./unit-profile";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
const state = (
  n: number,
  humid: number | null,
  dry: number | null,
  stage: WeightedState["growthStage"] = null
): WeightedState => ({
  effectiveAt: day(n),
  humidWeight: humid,
  dryWeight: dry,
  growthStage: stage,
});

describe("deriveMaterialClass", () => {
  it("names the material from type, parent and provider", () => {
    expect(deriveMaterialClass("SEEDLOT", { hasParent: false, hasProvider: false })).toBe("SEED");
    expect(deriveMaterialClass("CULTURE", { hasParent: true, hasProvider: false })).toBe("CULTURE");
    expect(deriveMaterialClass("FLOWER", { hasParent: false, hasProvider: false })).toBe("FLOWER");
    expect(deriveMaterialClass("PLANT", { hasParent: true, hasProvider: true })).toBe("CUTTING");
    expect(deriveMaterialClass("PLANT", { hasParent: false, hasProvider: true })).toBe("RECEIVED");
    expect(deriveMaterialClass("PLANT", { hasParent: false, hasProvider: false })).toBe("PLANT");
  });
});

describe("unitStatusOf", () => {
  it("lets leaving inventory win over a hold", () => {
    expect(unitStatusOf("DESTROYED", "HOLD")).toBe("destroyed");
    expect(unitStatusOf("SHIPPED_PART", "HOLD")).toBe("on-hold");
    expect(unitStatusOf("SHIPPED", null)).toBe("active");
  });
  it("reports holds and the plain active state", () => {
    expect(unitStatusOf("MOVED", "HOLD")).toBe("on-hold");
    expect(unitStatusOf("MEASURED", null)).toBe("active");
    expect(unitStatusOf(undefined, null)).toBe("active");
  });
  it("identifies terminal kinds", () => {
    expect(terminalKindOf("SHIPPED")).toBe("SHIPPED");
    expect(terminalKindOf("CREATED")).toBeNull();
    expect(terminalKindOf(null)).toBeNull();
  });
});

describe("summarizeWeights", () => {
  it("dates the weights by the event that last changed them", () => {
    const result = summarizeWeights("PLANT", [
      state(0, null, null, "VEGETATIVE"),
      state(5, 100, null, "HARVESTED"),
      state(6, 100, null, "HARVESTED"),
      state(9, 100, 25, "HARVESTED"),
      state(10, 100, 25, "HARVESTED"),
    ]);
    expect(result).toMatchObject({ humidWeight: 100, dryWeight: 25, isHarvested: true });
    expect(result.changedAt).toEqual(day(9));
  });

  it("has no date and is not harvested for a plain vegetative plant", () => {
    const result = summarizeWeights("PLANT", [state(0, null, null, "VEGETATIVE")]);
    expect(result).toEqual({
      humidWeight: null,
      dryWeight: null,
      changedAt: null,
      isHarvested: false,
    });
  });

  it("treats a post-flowering stage or a flower as harvested without weights", () => {
    expect(summarizeWeights("PLANT", [state(0, null, null, "DRYING")]).isHarvested).toBe(true);
    expect(summarizeWeights("FLOWER", [state(0, null, null)]).isHarvested).toBe(true);
  });
});
