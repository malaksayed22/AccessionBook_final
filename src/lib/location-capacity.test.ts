import { describe, expect, it } from "vitest";
import {
  assessLocationCapacity,
  canRetireLocation,
  countedGrams,
  NEAR_CAPACITY_RATIO,
  occupancyLevel,
  occupancyPercent,
} from "./location-capacity";

describe("occupancyLevel", () => {
  it("has nothing to compare without a limit", () => {
    expect(occupancyLevel(5, null)).toBe("unlimited");
    expect(occupancyLevel(5, 0)).toBe("unlimited");
    expect(occupancyLevel(0, undefined)).toBe("unlimited");
  });

  it("walks from ok to over capacity", () => {
    expect(occupancyLevel(0, 10)).toBe("ok");
    expect(occupancyLevel(8, 10)).toBe("ok");
    expect(occupancyLevel(9, 10)).toBe("near");
    expect(occupancyLevel(10, 10)).toBe("full");
    expect(occupancyLevel(11, 10)).toBe("over");
  });

  it("flags nearly full exactly at the threshold", () => {
    expect(NEAR_CAPACITY_RATIO).toBe(0.9);
    expect(occupancyLevel(89, 100)).toBe("ok");
    expect(occupancyLevel(90, 100)).toBe("near");
  });
});

describe("occupancyPercent", () => {
  it("rounds, may exceed 100, and is null without a limit", () => {
    expect(occupancyPercent(1, 3)).toBe(33);
    expect(occupancyPercent(12, 10)).toBe(120);
    expect(occupancyPercent(0, 10)).toBe(0);
    expect(occupancyPercent(4, null)).toBeNull();
  });
});

describe("canRetireLocation", () => {
  it("allows only an empty location", () => {
    expect(canRetireLocation(0)).toBe(true);
    expect(canRetireLocation(1)).toBe(false);
  });
});

describe("assessLocationCapacity (unchanged intake rule)", () => {
  const room = { id: 1, name: "Room 1", capacity: 10, occupancy: 8 };
  it("accepts what fits, refuses what does not, and ignores locations without a limit", () => {
    expect(assessLocationCapacity(room, 2).ok).toBe(true);
    expect(assessLocationCapacity(room, 3).ok).toBe(false);
    expect(assessLocationCapacity({ ...room, capacity: null }, 500)).toEqual({
      ok: true,
      message: null,
    });
    expect(assessLocationCapacity(null, 1).ok).toBe(true);
  });
});

describe("capacity counted in plants", () => {
  it("takes the plants of what arrives, not the units", () => {
    const rack = {
      id: 1,
      name: "Rack",
      capacity: 30,
      capacityMeasure: "PLANTS" as const,
      occupancy: 25,
    };
    expect(assessLocationCapacity(rack, { units: 1, plants: 5 }).ok).toBe(true);
    const over = assessLocationCapacity(rack, { units: 1, plants: 10 });
    expect(over.ok).toBe(false);
    expect(over.message).toContain("35 plants");
    // A seed lot brings no plants.
    expect(assessLocationCapacity(rack, { units: 3, plants: 0 }).ok).toBe(true);
    // Counting units, the same arrival is one unit.
    expect(
      assessLocationCapacity(
        { ...rack, capacityMeasure: "UNITS", occupancy: 29 },
        { units: 1, plants: 10 }
      ).ok
    ).toBe(true);
  });
});

describe("capacity by weight", () => {
  it("counts the dry weight once recorded, else the wet weight", () => {
    expect(countedGrams({ humidWeight: 500, dryWeight: 120 })).toBe(120);
    expect(countedGrams({ humidWeight: 500, dryWeight: null })).toBe(500);
    expect(countedGrams({})).toBe(0);
  });

  it("refuses what would overfill a drying room, and says it in kilograms", () => {
    const room = {
      id: 1,
      name: "Drying room",
      capacity: 50_000,
      capacityMeasure: "WEIGHT" as const,
    };
    expect(
      assessLocationCapacity({ ...room, occupancy: 45_000 }, { units: 1, plants: 0, grams: 4_000 })
    ).toEqual({ ok: true, message: "Drying room: 49 kg of 50 kg after intake (1 kg left)." });
    expect(
      assessLocationCapacity({ ...room, occupancy: 45_000 }, { units: 1, plants: 0, grams: 5_400 })
    ).toEqual({
      ok: false,
      message:
        "Drying room capacity exceeded: 50.4 kg planned but capacity is 50 kg (currently 45 kg stored).",
    });
    // Unweighed material (a seed lot, a culture) brings no weight.
    expect(assessLocationCapacity({ ...room, occupancy: 50_000 }, { units: 3, plants: 0 }).ok).toBe(
      true
    );
  });
});
