import { describe, expect, it } from "vitest";
import { isLaterStage, laterStages } from "./stage-order";

describe("stage order", () => {
  it("offers only the stages after the current one", () => {
    expect(laterStages("HARVESTED")).toEqual(["DRYING", "CURING", "STORAGE", "SEED"]);
    expect(laterStages("SEED")).toEqual([]);
  });

  it("offers every stage when none is recorded", () => {
    expect(laterStages(null)[0]).toBe("VEGETATIVE");
  });

  it("never goes back, nor stays", () => {
    expect(isLaterStage("FLOWERING", "VEGETATIVE")).toBe(false);
    expect(isLaterStage("FLOWERING", "FLOWERING")).toBe(false);
    expect(isLaterStage("FLOWERING", "HARVESTED")).toBe(true);
  });
});
