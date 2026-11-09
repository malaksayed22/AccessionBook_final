import { describe, expect, it } from "vitest";
import { projectHarvest } from "./harvest-projection";

const profile = { vegetativeDays: 30, floweringDays: 60, expectedYieldGrams: 40 };
const since = new Date("2026-10-01T12:00:00Z");

describe("projectHarvest", () => {
  it("projects flowering and harvest for a vegetative group, and its yield", () => {
    expect(projectHarvest({ stage: "VEGETATIVE", stageSince: since, plants: 25, profile })).toEqual(
      {
        floweringOn: new Date("2026-10-31T12:00:00Z"),
        harvestOn: new Date("2026-12-30T12:00:00Z"),
        expectedYieldGrams: 1000,
      }
    );
  });

  it("projects the harvest of a flowering plant from when flowering began", () => {
    expect(projectHarvest({ stage: "FLOWERING", stageSince: since, plants: 1, profile })).toEqual({
      floweringOn: null,
      harvestOn: new Date("2026-11-30T12:00:00Z"),
      expectedYieldGrams: 40,
    });
  });

  it("projects nothing without a profile, after harvest, or with nothing set", () => {
    expect(
      projectHarvest({ stage: "FLOWERING", stageSince: since, plants: 1, profile: null })
    ).toBeNull();
    expect(projectHarvest({ stage: "CURING", stageSince: since, plants: 1, profile })).toBeNull();
    expect(
      projectHarvest({
        stage: "VEGETATIVE",
        stageSince: since,
        plants: 1,
        profile: { vegetativeDays: null, floweringDays: null, expectedYieldGrams: null },
      })
    ).toBeNull();
  });
});
