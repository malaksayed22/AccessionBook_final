import { describe, expect, it } from "vitest";
import {
  buildStageSpans,
  daysBetween,
  deriveStageChanges,
  DURATION_STAGES,
  summarizeStageDurations,
  type StageStateLike,
} from "./stage-durations";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

function state(
  sequence: number,
  kind: string,
  growthStage: string | null,
  effectiveDay: number
): StageStateLike {
  return { sequence, kind, growthStage, effectiveAt: day(effectiveDay) };
}

describe("daysBetween", () => {
  it("rounds to whole days and never goes negative", () => {
    expect(daysBetween(day(0), day(10))).toBe(10);
    expect(daysBetween(day(10), day(0))).toBe(0);
  });
});

describe("deriveStageChanges", () => {
  it("computes from/to from the event recorded just before", () => {
    const changes = deriveStageChanges([
      state(1, "CREATED", "VEGETATIVE", 0),
      state(2, "MOVED", "VEGETATIVE", 3),
      state(3, "STAGE_CHANGED", "FLOWERING", 20),
      state(4, "STAGE_CHANGED", "HARVESTED", 80),
    ]);
    expect(changes.map((c) => [c.fromStage, c.toStage])).toEqual([
      ["VEGETATIVE", "FLOWERING"],
      ["FLOWERING", "HARVESTED"],
    ]);
    expect(changes.every((c) => !c.backDated)).toBe(true);
  });

  it("orders by recording sequence, whatever order it is given", () => {
    const changes = deriveStageChanges([
      state(3, "STAGE_CHANGED", "HARVESTED", 80),
      state(1, "CREATED", "VEGETATIVE", 0),
      state(2, "STAGE_CHANGED", "FLOWERING", 20),
    ]);
    expect(changes.map((c) => c.toStage)).toEqual(["FLOWERING", "HARVESTED"]);
  });

  it("flags a change filed after an event with a later effective date as back-dated", () => {
    const changes = deriveStageChanges([
      state(1, "CREATED", "VEGETATIVE", 0),
      state(2, "STAGE_CHANGED", "FLOWERING", 30),
      state(3, "STAGE_CHANGED", "HARVESTED", 10),
    ]);
    expect(changes.map((c) => c.backDated)).toEqual([false, true]);
  });

  it("returns nothing for a unit that never changed stage", () => {
    expect(deriveStageChanges([state(1, "CREATED", "VEGETATIVE", 0)])).toEqual([]);
  });
});

describe("buildStageSpans", () => {
  const now = day(100);

  it("starts from the first event's stage and keeps the last span open", () => {
    const spans = buildStageSpans(
      [
        state(1, "CREATED", "VEGETATIVE", 0),
        state(2, "STAGE_CHANGED", "FLOWERING", 30),
        state(3, "STAGE_CHANGED", "HARVESTED", 90),
      ],
      { now }
    );
    expect(spans.map((s) => [s.stage, s.days, s.ongoing])).toEqual([
      ["VEGETATIVE", 30, false],
      ["FLOWERING", 60, false],
      ["HARVESTED", 10, true],
    ]);
    expect(spans[0]?.start).toEqual(day(0));
    expect(spans[0]?.end).toEqual(day(30));
    expect(spans[2]?.end).toBeNull();
  });

  it("measures by effective date, not by recording order", () => {
    // The harvest was filed last but happened before the flowering change was filed.
    const spans = buildStageSpans(
      [
        state(1, "CREATED", "VEGETATIVE", 0),
        state(2, "STAGE_CHANGED", "HARVESTED", 60),
        state(3, "STAGE_CHANGED", "FLOWERING", 20),
      ],
      { now }
    );
    expect(spans.map((s) => [s.stage, s.days])).toEqual([
      ["VEGETATIVE", 20],
      ["FLOWERING", 40],
      ["HARVESTED", 40],
    ]);
  });

  it("merges consecutive entries into the same stage", () => {
    const spans = buildStageSpans(
      [
        state(1, "CREATED", "VEGETATIVE", 0),
        state(2, "STAGE_CHANGED", "VEGETATIVE", 5),
        state(3, "STAGE_CHANGED", "FLOWERING", 10),
      ],
      { now }
    );
    expect(spans.map((s) => s.stage)).toEqual(["VEGETATIVE", "FLOWERING"]);
  });

  it("starts a harvested flower in HARVESTED and follows its drying chain", () => {
    const spans = buildStageSpans(
      [
        state(1, "CREATED", "HARVESTED", 0),
        state(2, "STAGE_CHANGED", "DRYING", 2),
        state(3, "STAGE_CHANGED", "CURING", 12),
        state(4, "STAGE_CHANGED", "STORAGE", 40),
      ],
      { now }
    );
    expect(spans.map((s) => [s.stage, s.days])).toEqual([
      ["HARVESTED", 2],
      ["DRYING", 10],
      ["CURING", 28],
      ["STORAGE", 60],
    ]);
  });

  it("ends the last span at the time the unit left inventory", () => {
    const spans = buildStageSpans(
      [
        state(1, "CREATED", "VEGETATIVE", 0),
        state(2, "STAGE_CHANGED", "FLOWERING", 30),
        state(3, "DESTROYED", "FLOWERING", 45),
      ],
      { now, endedAt: day(45) }
    );
    const last = spans[spans.length - 1];
    expect(last).toMatchObject({ stage: "FLOWERING", days: 15, ongoing: false });
    expect(last?.end).toEqual(day(45));
  });

  it("ignores untracked stages and units without stages (seed lots, cultures)", () => {
    expect(buildStageSpans([state(1, "CREATED", null, 0)], { now })).toEqual([]);
    expect(buildStageSpans([state(1, "CREATED", "SEED", 0)], { now })).toEqual([]);
  });
});

describe("summarizeStageDurations", () => {
  const now = day(100);

  it("sums repeat visits to a stage and reports the current span", () => {
    const summary = summarizeStageDurations(
      [
        state(1, "CREATED", "VEGETATIVE", 0),
        state(2, "STAGE_CHANGED", "FLOWERING", 20),
        state(3, "STAGE_CHANGED", "VEGETATIVE", 30),
      ],
      { now }
    );
    expect(summary.totals).toEqual({ VEGETATIVE: 90, FLOWERING: 10 });
    expect(summary.current?.stage).toBe("VEGETATIVE");
    expect(summary.totalDays).toBe(100);
  });

  it("has no current span once the unit has left inventory", () => {
    const summary = summarizeStageDurations(
      [state(1, "CREATED", "VEGETATIVE", 0), state(2, "DESTROYED", "VEGETATIVE", 10)],
      { now, endedAt: day(10) }
    );
    expect(summary.current).toBeNull();
    expect(summary.totals).toEqual({ VEGETATIVE: 10 });
  });

  it("is empty without events", () => {
    expect(summarizeStageDurations([], { now })).toEqual({
      spans: [],
      totals: {},
      current: null,
      totalDays: 0,
    });
  });
});

describe("DURATION_STAGES", () => {
  it("lists the counters in lifecycle order and only tracked stages", () => {
    expect(DURATION_STAGES).toEqual(["VEGETATIVE", "FLOWERING", "DRYING", "CURING", "STORAGE"]);
  });
});
