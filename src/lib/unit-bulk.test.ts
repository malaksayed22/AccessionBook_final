import { describe, expect, it } from "vitest";
import { planBulk, skipReason, type BulkUnit } from "./unit-bulk";

const unit = (over: Partial<BulkUnit> = {}): BulkUnit => ({
  id: 1,
  name: "U1",
  type: "PLANT",
  status: "active",
  locationId: 1,
  growthStage: "VEGETATIVE",
  ...over,
});

describe("skipReason", () => {
  it("takes active units for every action", () => {
    for (const action of ["move", "stage", "hold", "destroy"] as const) {
      expect(skipReason(action, unit())).toBeNull();
    }
  });

  it("leaves out units that cannot take any action, and says why", () => {
    expect(skipReason("move", unit({ status: "on-hold" }))).toBe("held");
    expect(skipReason("hold", unit({ status: "on-hold" }))).toBe("held");
    expect(skipReason("destroy", unit({ status: "destroyed" }))).toBe("destroyed");
    expect(skipReason("move", unit({ nothingLeft: true }))).toBe("shipped");
  });

  it("records an activity on held units too, never on destroyed or emptied ones", () => {
    expect(skipReason("activity", unit({ status: "on-hold" }))).toBeNull();
    expect(skipReason("activity", unit({ type: "SEEDLOT" }))).toBeNull();
    expect(skipReason("activity", unit({ status: "destroyed" }))).toBe("destroyed");
    expect(skipReason("activity", unit({ nothingLeft: true }))).toBe("shipped");
  });

  it("changes stage only on plants and flowers", () => {
    expect(skipReason("stage", unit({ type: "FLOWER" }))).toBeNull();
    expect(skipReason("stage", unit({ type: "SEEDLOT" }))).toBe("notApplicable");
    expect(skipReason("stage", unit({ type: "CULTURE" }))).toBe("notApplicable");
    expect(skipReason("move", unit({ type: "SEEDLOT" }))).toBeNull();
  });
});

describe("what the person chose", () => {
  it("leaves out units already in the chosen room or stage", () => {
    expect(skipReason("move", unit({ locationId: 5 }), { toLocationId: 5 })).toBe("alreadyThere");
    expect(skipReason("move", unit({ locationId: 4 }), { toLocationId: 5 })).toBeNull();
    expect(skipReason("stage", unit(), { toStage: "VEGETATIVE" })).toBe("alreadyInStage");
    expect(skipReason("stage", unit(), { toStage: "FLOWERING" })).toBeNull();
  });
});

describe("planBulk", () => {
  it("splits a selection into what will be sent and what is skipped, per reason", () => {
    const selected = [
      unit({ id: 1 }),
      unit({ id: 2, status: "on-hold" }),
      unit({ id: 3, status: "on-hold" }),
      unit({ id: 4, status: "destroyed" }),
      unit({ id: 5, type: "SEEDLOT" }),
    ];
    const plan = planBulk("stage", selected);
    expect(plan.eligible.map((u) => u.id)).toEqual([1]);
    expect(plan.skipped).toEqual({ held: 2, destroyed: 1, notApplicable: 1 });
    expect(plan.skippedCount).toBe(4);
  });
});

describe("releasing holds in bulk", () => {
  it("takes only units on hold", () => {
    expect(skipReason("release", unit({ status: "on-hold" }))).toBeNull();
    expect(skipReason("release", unit({ status: "on-hold", nothingLeft: true }))).toBeNull();
    expect(skipReason("release", unit())).toBe("notHeld");
    expect(skipReason("release", unit({ status: "destroyed" }))).toBe("destroyed");
  });
});
