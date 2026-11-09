import { describe, expect, it } from "vitest";
import {
  addDays,
  bandLayout,
  dayKeysBetween,
  labelSlots,
  maxOf,
  niceTicks,
  scaleLinear,
  slotIndexAt,
  weekStartKey,
} from "./chart-math";

describe("scaleLinear", () => {
  it("maps the domain onto the range, including inverted ranges", () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(25)).toBe(150);
  });

  it("does not divide by zero for a flat domain", () => {
    expect(scaleLinear([5, 5], [10, 90])(5)).toBe(10);
  });
});

describe("niceTicks", () => {
  it.each([
    [7, [0, 2, 4, 6, 8]],
    [100, [0, 25, 50, 75, 100]],
    [3, [0, 1, 2, 3]],
    [1, [0, 0.25, 0.5, 0.75, 1]],
  ])("covers %s with clean steps starting at zero", (max, expected) => {
    const ticks = niceTicks(max);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max);
    expect(ticks).toEqual(expected);
  });

  it("copes with zero, negatives and NaN", () => {
    for (const bad of [0, -5, Number.NaN]) {
      const ticks = niceTicks(bad);
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBeGreaterThan(1);
    }
  });

  it("keeps large values compact", () => {
    const ticks = niceTicks(12_345);
    expect(ticks.at(-1)!).toBeGreaterThanOrEqual(12_345);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });
});

describe("bandLayout", () => {
  it("caps bar thickness at 24px and centres bars in their slots", () => {
    const layout = bandLayout(4, 800);
    expect(layout.slot).toBe(200);
    expect(layout.bar).toBe(24);
    expect(layout.x(0)).toBe((200 - 24) / 2);
    expect(layout.center(1)).toBe(300);
  });

  it("shrinks bars when slots are narrow and never goes below 1px", () => {
    expect(bandLayout(100, 300).bar).toBeCloseTo(1.86, 1);
    expect(bandLayout(1000, 100).bar).toBe(1);
  });
});

describe("slotIndexAt", () => {
  it("finds the slot under a position and clamps at the edges", () => {
    expect(slotIndexAt(0, 100, 10)).toBe(0);
    expect(slotIndexAt(55, 100, 10)).toBe(5);
    expect(slotIndexAt(999, 100, 10)).toBe(9);
    expect(slotIndexAt(-20, 100, 10)).toBe(0);
    expect(slotIndexAt(5, 0, 10)).toBe(0);
  });
});

describe("day arithmetic", () => {
  it("lists every day inclusively across month and year ends", () => {
    expect(dayKeysBetween("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(dayKeysBetween("2026-10-24", "2026-10-24")).toEqual(["2026-10-24"]);
    expect(dayKeysBetween("2026-10-25", "2026-10-24")).toEqual([]);
  });

  it("finds the Monday of a week and adds days", () => {
    expect(weekStartKey("2026-10-24")).toBe("2026-10-19"); // Saturday
    expect(weekStartKey("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStartKey("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("maxOf and labelSlots", () => {
  it("sums stacked series and takes the maximum of grouped ones", () => {
    expect(
      maxOf(
        [
          [1, 4],
          [2, 1],
        ],
        true
      )
    ).toBe(5);
    expect(
      maxOf(
        [
          [1, 4],
          [2, 1],
        ],
        false
      )
    ).toBe(4);
    expect(maxOf([], true)).toBe(1);
    expect(maxOf([[0, 0]], true)).toBe(1);
  });

  it("labels about every nth slot and always the most recent", () => {
    const slots = labelSlots(30, 320, 64);
    expect(slots.has(29)).toBe(true);
    expect(slots.size).toBeLessThanOrEqual(6);
    expect(labelSlots(5, 800).size).toBe(5);
  });
});

describe("rings and donuts", () => {
  it("places angle 0 at 12 o'clock and runs clockwise", async () => {
    const { polar } = await import("./chart-math");
    expect(polar(50, 50, 10, 0)).toEqual({ x: 50, y: 40 });
    const quarter = polar(50, 50, 10, Math.PI / 2);
    expect(quarter.x).toBeCloseTo(60);
    expect(quarter.y).toBeCloseTo(50);
  });

  it("splits a turn proportionally with air between slices and skips empty ones", async () => {
    const { sliceAngles } = await import("./chart-math");
    const slices = sliceAngles([3, 1, 0], 0.04);
    expect(slices[2]).toBeNull();
    const [a, b] = [slices[0]!, slices[1]!];
    const spanA = a.end - a.start;
    const spanB = b.end - b.start;
    expect(spanA / spanB).toBeCloseTo(3);
    expect(b.start - a.end).toBeCloseTo(0.04);
    expect(a.start + (Math.PI * 2 - b.end)).toBeCloseTo(0.04);
  });

  it("fills the whole ring for a single slice and returns nothing for no data", async () => {
    const { sliceAngles } = await import("./chart-math");
    const [only] = sliceAngles([7]);
    expect(only!.end - only!.start).toBeCloseTo(Math.PI * 2);
    expect(sliceAngles([0, 0])).toEqual([null, null]);
    expect(sliceAngles([Number.NaN, -3])).toEqual([null, null]);
  });

  it("draws closed ring paths, splitting a full turn in two", async () => {
    const { ringSlicePath } = await import("./chart-math");
    const quarter = ringSlicePath(50, 50, 40, 28, 0, Math.PI / 2);
    expect(quarter.startsWith("M")).toBe(true);
    expect(quarter.endsWith("Z")).toBe(true);
    expect(quarter).toContain("0 0 1");
    const half = ringSlicePath(50, 50, 40, 28, 0, Math.PI * 1.5);
    expect(half).toContain("0 1 1");
    expect(ringSlicePath(50, 50, 40, 28, 0, Math.PI * 2).split("M")).toHaveLength(3);
  });
});
