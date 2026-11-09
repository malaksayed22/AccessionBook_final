import { describe, expect, it } from "vitest";
import { buildStageSpans, spanDays, stageBucketOf, stageSegments } from "./experiment-progress";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const now = at("2026-06-01");

describe("stageBucketOf", () => {
  it("puts seed lots and cultures in their own buckets and plants by their stage", () => {
    expect(stageBucketOf("SEEDLOT", null)).toBe("SEED");
    expect(stageBucketOf("CULTURE", "VEGETATIVE")).toBe("CULTURE");
    expect(stageBucketOf("PLANT", "FLOWERING")).toBe("FLOWERING");
    expect(stageBucketOf("PLANT", null)).toBe("NONE");
    expect(stageBucketOf("FLOWER", "NOT_A_STAGE")).toBe("NONE");
  });
});

describe("spanDays", () => {
  it("counts whole days, at least one, and up to now while the stage is ongoing", () => {
    expect(spanDays(at("2026-05-01"), at("2026-05-11"), now)).toBe(10);
    expect(spanDays(at("2026-05-01"), at("2026-05-01"), now)).toBe(1);
    expect(spanDays(at("2026-05-22"), null, now)).toBe(10);
  });
});

describe("buildStageSpans", () => {
  it("merges rows into one span per stage, in lifecycle order, leaving unstaged units out", () => {
    const spans = buildStageSpans(
      [
        { stage: "FLOWERING", started: at("2026-04-01"), ended: at("2026-05-01") },
        { stage: "VEGETATIVE", started: at("2026-03-01"), ended: at("2026-04-01") },
        { stage: "VEGETATIVE", started: at("2026-03-05"), ended: at("2026-04-10") },
        { stage: "NONE", started: at("2026-01-01"), ended: null },
      ],
      now
    );
    expect(spans.map((s) => s.stage)).toEqual(["VEGETATIVE", "FLOWERING"]);
    expect(spans[0]).toMatchObject({
      started: at("2026-03-01"),
      ended: at("2026-04-10"),
      days: 40,
    });
    expect(spans[1]).toMatchObject({ days: 30 });
  });

  it("is ongoing as soon as any unit is still in the stage", () => {
    const [span] = buildStageSpans(
      [
        { stage: "DRYING", started: at("2026-05-01"), ended: at("2026-05-08") },
        { stage: "DRYING", started: at("2026-05-02"), ended: null },
      ],
      now
    );
    expect(span).toMatchObject({ ended: null, days: 31 });
  });

  it("is empty when no unit has a place on the timeline", () => {
    expect(buildStageSpans([], now)).toEqual([]);
  });
});

describe("stageSegments", () => {
  it("lays the stages on one continuous bar, each running until the next one starts", () => {
    const spans = buildStageSpans(
      [
        { stage: "VEGETATIVE", started: at("2026-05-01"), ended: at("2026-05-11") },
        { stage: "FLOWERING", started: at("2026-05-11"), ended: at("2026-05-31") },
      ],
      now
    );
    const [first, second] = stageSegments(spans, now);
    expect(first!.left).toBe(0);
    expect(first!.width).toBeCloseTo(33.3, 0);
    expect(second!.left).toBeCloseTo(first!.width, 5);
    expect(second!.left + second!.width).toBeCloseTo(100, 5);
  });

  it("shares a stretch equally between stages that started the same day and keeps short ones visible", () => {
    const spans = buildStageSpans(
      [
        { stage: "SEED", started: at("2026-01-01"), ended: null },
        { stage: "VEGETATIVE", started: at("2026-01-01"), ended: at("2026-01-02") },
        { stage: "FLOWERING", started: at("2026-01-02"), ended: null },
      ],
      now
    );
    const segments = stageSegments(spans, now);
    expect(segments).toHaveLength(3);
    expect(segments.every((s) => s.width >= 5)).toBe(true);
    expect(segments.reduce((sum, s) => sum + s.width, 0)).toBeCloseTo(100, 5);
  });

  it("is empty without stages", () => {
    expect(stageSegments([], now)).toEqual([]);
  });
});

describe("buildStageSpans for a completed experiment", () => {
  it("ends the stages still running on the day it was completed", () => {
    const [span] = buildStageSpans(
      [{ stage: "DRYING", started: at("2026-05-01"), ended: null }],
      now,
      at("2026-05-21")
    );
    expect(span).toMatchObject({ ended: at("2026-05-21"), days: 20 });
  });

  it("ends a stage that began on the completion day, even if it began later that day", () => {
    const started = new Date("2026-05-21T12:24:00Z");
    const [span] = buildStageSpans(
      [{ stage: "FLOWERING", started, ended: null }],
      now,
      at("2026-05-21")
    );
    expect(span).toMatchObject({ ended: started, days: 1 });
  });
});
