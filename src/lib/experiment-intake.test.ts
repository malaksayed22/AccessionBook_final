import { describe, expect, it } from "vitest";
import {
  describeIntakeIssue,
  expandIntakeUnits,
  findIntakeIssue,
  suggestedKindForUnitType,
  totalIntakeUnits,
  validateIntake,
  type IntakeGroupInput,
  type IntakeInput,
} from "./experiment-intake";

const group = (over: Partial<IntakeGroupInput> = {}): IntakeGroupInput => ({
  kind: "CLONES",
  cultivarId: 1,
  quantity: 2,
  statusMode: "SAME",
  status: "VEGETATIVE",
  ...over,
});

const intake = (over: Partial<IntakeInput> = {}): IntakeInput => ({
  locationId: 1,
  providerMode: "INTERNAL",
  providerOrganizationId: null,
  sourceDescription: "Internal mother room stock",
  groups: [group()],
  ...over,
});

describe("findIntakeIssue", () => {
  it("accepts a complete intake and an empty one, and an internal source nobody described", () => {
    expect(findIntakeIssue(intake())).toBeNull();
    expect(findIntakeIssue(intake({ groups: [], locationId: null }))).toBeNull();
    expect(findIntakeIssue(intake({ sourceDescription: "" }))).toBeNull();
    expect(findIntakeIssue(intake({ sourceDescription: "short" }))).toBeNull();
  });

  it("reports source problems before unit problems, in the order a person fixes them", () => {
    expect(
      findIntakeIssue(intake({ locationId: null, groups: [group({ cultivarId: null })] }))?.code
    ).toBe("location_required");
    expect(findIntakeIssue(intake({ providerMode: "EXTERNAL" }))?.code).toBe("supplier_required");
    // The material source is required even when the experiment starts with no units.
    expect(findIntakeIssue(intake({ providerMode: "EXTERNAL", groups: [] }))?.code).toBe(
      "supplier_required"
    );
    expect(findIntakeIssue(intake({ groups: [group({ cultivarId: null })] }))).toEqual({
      code: "cultivar_required",
      group: 0,
    });
  });

  it("has no practical limit on a group, only a safeguard against a typo", () => {
    expect(findIntakeIssue(intake({ groups: [group({ quantity: 5000 })] }))).toBeNull();
    const issue = findIntakeIssue(
      intake({ groups: [group({ quantity: 60_000 }), group({ quantity: 60_000 })] })
    );
    expect(issue).toEqual({ code: "too_many_units", params: { max: 100_000, total: 120_000 } });
    expect(findIntakeIssue(intake({ groups: [group({ quantity: 0 })] }))?.code).toBe(
      "quantity_invalid"
    );
    expect(findIntakeIssue(intake({ groups: [group({ kind: "NOPE" })] }))?.code).toBe(
      "unknown_kind"
    );
  });

  it("checks that split counts add up", () => {
    const mixed = group({
      quantity: 4,
      cultivarMode: "MIXED",
      cultivarBreakdown: [{ cultivarId: 1, count: 3 }],
    });
    expect(findIntakeIssue(intake({ groups: [mixed] }))).toEqual({
      code: "cultivar_split_sum",
      group: 0,
      params: { sum: 3, quantity: 4 },
    });
    const badStatus = group({ statusMode: "MIXED", breakdown: [{ status: "DRYING", count: 2 }] });
    const issue = findIntakeIssue(intake({ groups: [badStatus] }));
    expect(issue).toMatchObject({ code: "status_split_invalid", params: { status: "DRYING" } });
  });

  it("only asks for a status on material that has stages", () => {
    expect(
      findIntakeIssue(intake({ groups: [group({ kind: "SEEDS", status: null })] }))
    ).toBeNull();
    expect(findIntakeIssue(intake({ groups: [group({ status: null })] }))?.code).toBe(
      "status_required"
    );
  });
});

describe("validateIntake (the server's English text)", () => {
  it("keeps the sentences the API has always returned", () => {
    expect(validateIntake(intake({ locationId: null }))).toBe(
      "Location is required when the experiment starts with units"
    );
    expect(validateIntake(intake({ groups: [group({ quantity: 0 })] }))).toBe(
      "Unit group 1: quantity must be a whole number of at least 1"
    );
    expect(
      validateIntake(
        intake({
          groups: [group({ statusMode: "MIXED", breakdown: [{ status: "DRYING", count: 2 }] })],
        })
      )
    ).toBe('Unit group 1: "DRYING" is not a valid status for clones / cuttings');
    expect(validateIntake(intake())).toBeNull();
  });

  it("describes every issue code", () => {
    expect(describeIntakeIssue({ code: "weight_wet_invalid", group: 1 })).toBe(
      "Unit group 2: wet weight must be zero or more grams"
    );
  });
});

describe("expandIntakeUnits", () => {
  it("expands mixed cultivars and statuses in order", () => {
    const units = expandIntakeUnits(
      group({
        quantity: 3,
        cultivarMode: "MIXED",
        cultivarBreakdown: [
          { cultivarId: 1, count: 2 },
          { cultivarId: 2, count: 1 },
        ],
        statusMode: "MIXED",
        breakdown: [
          { status: "VEGETATIVE", count: 1 },
          { status: "FLOWERING", count: 2 },
        ],
      })
    );
    expect(units).toEqual([
      { stage: "VEGETATIVE", cultivarId: 1 },
      { stage: "FLOWERING", cultivarId: 1 },
      { stage: "FLOWERING", cultivarId: 2 },
    ]);
  });

  it("gives material without stages no stage", () => {
    expect(expandIntakeUnits(group({ kind: "SEEDS", quantity: 2 }))).toEqual([
      { stage: null, cultivarId: 1 },
      { stage: null, cultivarId: 1 },
    ]);
  });
});

describe("helpers", () => {
  it("suggests a material type for a unit type and totals groups", () => {
    expect(suggestedKindForUnitType("SEEDLOT")).toBe("SEEDS");
    expect(suggestedKindForUnitType("FLOWER")).toBe("FLOWERS");
    expect(suggestedKindForUnitType("CULTURE")).toBe("CULTURES");
    expect(suggestedKindForUnitType("PLANT")).toBe("CLONES");
    expect(totalIntakeUnits([group({ quantity: 2 }), group({ quantity: 5 })])).toBe(7);
  });
});

describe("harvested flower weight", () => {
  it("asks for a wet or dry weight, since harvested material is reported by weight", () => {
    const flower = group({ kind: "FLOWERS", status: "HARVESTED", quantity: 1 });
    expect(findIntakeIssue(intake({ groups: [flower] }))?.code).toBe("weight_required");
    expect(findIntakeIssue(intake({ groups: [{ ...flower, dryWeightGrams: 12.5 }] }))).toBeNull();
    expect(findIntakeIssue(intake({ groups: [{ ...flower, wetWeightGrams: 0 }] }))).toBeNull();
  });
});
