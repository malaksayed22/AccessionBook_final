import { describe, expect, it } from "vitest";
import { buildCultivarStatsMap, type StatsUnit } from "./card-stats";

function unit(
  type: string,
  experimentId: number,
  cultivarId: number,
  state: NonNullable<StatsUnit["currentState"]>
): StatsUnit {
  return {
    type,
    experiment: { id: experimentId },
    cultivar: { id: cultivarId },
    currentState: state,
  };
}

const units: StatsUnit[] = [
  unit("PLANT", 1, 10, { growthStage: "VEGETATIVE", location: { name: "Room 1" } }),
  unit("PLANT", 1, 10, { growthStage: "FLOWERING", location: { name: "Room 1" } }),
  unit("FLOWER", 1, 11, { growthStage: "DRYING", dryWeight: 5, location: { name: "Drying" } }),
  unit("SEEDLOT", 2, 10, { seedCount: 250, location: null }),
];

describe("buildCultivarStatsMap", () => {
  const map = buildCultivarStatsMap(units, [10, 11, 12], { 10: 5, 11: 1, 12: 4 });

  it("counts active units by stage, type and location", () => {
    const stats = map.get(10);
    expect(stats).toMatchObject({
      totalUnits: 5,
      activeUnits: 3,
      destroyedUnits: 2,
      topLocation: "Room 1",
      hasPlants: true,
      hasDestroyed: true,
    });
    expect(stats?.stageCounts).toMatchObject({ VEGETATIVE: 1, FLOWERING: 1, SEED: 1 });
    expect(stats?.typeCounts).toEqual({ PLANT: 2, SEEDLOT: 1 });
    expect(stats?.allLocations).toEqual([{ name: "Room 1", count: 2 }]);
  });

  it("adds up seed counts for seed lots", () => {
    expect(map.get(10)?.seedCount).toBe(250);
  });

  it("marks post-harvest material as harvested", () => {
    expect(map.get(11)).toMatchObject({ hasHarvested: true, topLocation: "Drying" });
    expect(map.get(11)?.stageCounts.DRYING).toBe(1);
  });

  it("treats a cultivar with no active units as fully ended", () => {
    expect(map.get(12)).toMatchObject({
      activeUnits: 0,
      destroyedUnits: 4,
      dominantStage: null,
      hasDestroyed: true,
    });
  });

  it("also counts the distinct experiments a cultivar appears in", () => {
    expect(map.get(10)).toMatchObject({ activeUnits: 3, experimentCount: 2 });
    expect(map.get(11)).toMatchObject({ activeUnits: 1, experimentCount: 1 });
  });
});
