import { describe, expect, it } from "vitest";
import {
  deriveLifecycleStageId,
  dominantStage,
  emptyStageCounts,
  isPostHarvestStage,
} from "./lifecycle-stages";

describe("deriveLifecycleStageId", () => {
  it("maps seed lots and cultures to their own buckets", () => {
    expect(deriveLifecycleStageId({ type: "SEEDLOT", currentState: null })).toBe("SEED");
    expect(deriveLifecycleStageId({ type: "CULTURE", currentState: null })).toBe("CULTURE");
  });

  it("uses a plant's growth stage", () => {
    expect(
      deriveLifecycleStageId({ type: "PLANT", currentState: { growthStage: "FLOWERING" } })
    ).toBe("FLOWERING");
  });

  it("treats a plant without a stage as vegetative unless it carries a weight", () => {
    expect(deriveLifecycleStageId({ type: "PLANT", currentState: { growthStage: null } })).toBe(
      "VEGETATIVE"
    );
    expect(
      deriveLifecycleStageId({
        type: "PLANT",
        currentState: { growthStage: null, dryWeight: { toString: () => "12.5" } },
      })
    ).toBe("HARVESTED");
  });

  it("defaults a flower to harvested and follows its post-harvest stage", () => {
    expect(deriveLifecycleStageId({ type: "FLOWER", currentState: null })).toBe("HARVESTED");
    expect(
      deriveLifecycleStageId({ type: "FLOWER", currentState: { growthStage: "CURING" } })
    ).toBe("CURING");
  });
});

describe("isPostHarvestStage", () => {
  it("is true from harvest onwards only", () => {
    expect(isPostHarvestStage("VEGETATIVE")).toBe(false);
    expect(isPostHarvestStage("FLOWERING")).toBe(false);
    expect(isPostHarvestStage("HARVESTED")).toBe(true);
    expect(isPostHarvestStage("STORAGE")).toBe(true);
  });
});

describe("dominantStage", () => {
  it("picks the most common stage and ignores an empty mix", () => {
    const counts = emptyStageCounts();
    expect(dominantStage(counts)).toBeNull();
    counts.FLOWERING = 3;
    counts.VEGETATIVE = 1;
    expect(dominantStage(counts)).toEqual({ id: "FLOWERING", label: "Flowering", count: 3 });
  });
});
