import { describe, expect, it } from "vitest";
import {
  blankGroup,
  initialState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "./wizard-state";
import {
  firstInvalidStep,
  hasErrors,
  validateAll,
  validateIdentity,
  validateReview,
  validateSource,
  validateUnits,
  type ValidationContext,
} from "./wizard-validation";

const context: ValidationContext = {
  locations: [
    { id: 1, capacity: 10, occupancy: 8 },
    { id: 2, capacity: null, occupancy: 0 },
  ],
};

/** Starts with one blank unit group (g0) so quantities and splits can be exercised; units are optional. */
function build(...actions: WizardAction[]): WizardState {
  const start = {
    ...initialState({ today: "2026-03-04" }),
    groups: [blankGroup(0, "PLANTS", true)],
  };
  return actions.reduce(wizardReducer, start);
}

/** A state that passes every step. */
const valid = () =>
  build(
    {
      type: "set",
      patch: {
        name: "Photoperiod",
        locationId: "2",
        sourceDescription: "Internal mother room stock",
      },
    },
    { type: "updateGroup", key: "g0", patch: { cultivarId: "3", status: "VEGETATIVE" } }
  );

describe("starting status", () => {
  it("is required for a unit that has stages, with nothing chosen by default", () => {
    const noStatus = build({ type: "updateGroup", key: "g0", patch: { cultivarId: "3" } });
    expect(validateUnits(noStatus)["groups.0.status"]?.code).toBe("status_required");
  });
});

describe("validateIdentity", () => {
  it("accepts a name and a plan", () => {
    expect(validateIdentity(valid())).toEqual({});
  });

  it("asks for a name, and not for one longer than the API accepts", () => {
    expect(validateIdentity(build({ type: "set", patch: { name: "   " } })).name?.code).toBe(
      "name_required"
    );
    const long = build({ type: "set", patch: { name: "x".repeat(201) } });
    expect(validateIdentity(long).name).toEqual({ code: "name_too_long", values: { max: 200 } });
  });

  it("checks the start date; there is no end date or code to enter", () => {
    const missing = validateIdentity(build({ type: "set", patch: { name: "A", startDate: "" } }));
    expect(missing.startDate?.code).toBe("start_required");
    expect(Object.keys(missing)).toEqual(["startDate"]);
    expect(
      validateIdentity(build({ type: "set", patch: { name: "A", startDate: "2026-02-30x" } }))
        .startDate?.code
    ).toBe("date_invalid");
  });

  it("limits the notes", () => {
    const errors = validateIdentity(
      build({ type: "set", patch: { name: "A", comment: "x".repeat(2001) } })
    );
    expect(errors.comment?.code).toBe("comment_too_long");
  });
});

describe("validateUnits", () => {
  it("requires a cultivar and a sensible quantity per group, naming the group and field", () => {
    const state = build(
      { type: "addGroup" },
      { type: "updateGroup", key: "g0", patch: { cultivarId: "3" } },
      { type: "updateGroup", key: "g1", patch: { quantity: "0" } }
    );
    const errors = validateUnits(state);
    expect(errors["groups.0.cultivar"]).toBeUndefined();
    expect(errors["groups.1.quantity"]).toEqual({
      code: "quantity_invalid",
      values: { max: 100000 },
    });
  });

  it("checks mixed cultivar and status counts add up to the quantity", () => {
    const state = build({
      type: "updateGroup",
      key: "g0",
      patch: { quantity: "5", cultivarMode: "MIXED", cultivarBreakdown: { "2": "3" } },
    });
    expect(validateUnits(state)["groups.0.cultivar"]).toEqual({
      code: "cultivar_split_sum",
      values: { sum: 3, quantity: 5 },
    });
    const ok = build({
      type: "updateGroup",
      key: "g0",
      patch: {
        quantity: "5",
        cultivarMode: "MIXED",
        cultivarBreakdown: { "2": "3", "4": "2" },
        statusMode: "MIXED",
        breakdown: { VEGETATIVE: "5" },
      },
    });
    expect(validateUnits(ok)).toEqual({});
    const noStatus = build({
      type: "updateGroup",
      key: "g0",
      patch: { cultivarId: "3", statusMode: "MIXED", breakdown: {} },
    });
    expect(validateUnits(noStatus)["groups.0.status"]?.code).toBe("status_split_missing");
  });

  it("has no practical limit on a group, only a safeguard against a typo, and checks seed and weight values", () => {
    // 600 units in one go is fine: the old limit of 500 is gone.
    const many = build({
      type: "updateGroup",
      key: "g0",
      patch: { cultivarId: "3", quantity: "600", status: "VEGETATIVE" },
    });
    expect(validateUnits(many)).toEqual({});

    const typo = build(
      { type: "addGroup" },
      { type: "updateGroup", key: "g0", patch: { cultivarId: "3", quantity: "60000" } },
      { type: "updateGroup", key: "g1", patch: { cultivarId: "3", quantity: "60000" } }
    );
    expect(validateUnits(typo).groups).toEqual({
      code: "too_many_units",
      values: { max: 100000, total: 120000 },
    });

    const seeds = build(
      { type: "changeKind", key: "g0", kind: "SEEDS" },
      { type: "updateGroup", key: "g0", patch: { cultivarId: "3", seedsPerLot: "0.5" } }
    );
    expect(validateUnits(seeds)["groups.0.seedsPerLot"]?.code).toBe("seeds_invalid");

    const flower = build(
      { type: "changeKind", key: "g0", kind: "FLOWERS" },
      {
        type: "updateGroup",
        key: "g0",
        patch: { cultivarId: "3", status: "HARVESTED", dryWeightGrams: "-1" },
      }
    );
    expect(validateUnits(flower)["groups.0.dryWeightGrams"]?.code).toBe("weight_dry_invalid");
  });

  it("allows an experiment with no starting units", () => {
    expect(validateUnits(build({ type: "removeGroup", key: "g0" }))).toEqual({});
  });
});

describe("validateSource", () => {
  it("needs a location when there are units, and nothing about internal stock", () => {
    const errors = validateSource(
      build({ type: "updateGroup", key: "g0", patch: { cultivarId: "3" } })
    );
    expect(errors.location?.code).toBe("location_required");
    // Describing an internal source is optional, however short or absent.
    for (const sourceDescription of ["", "short"]) {
      expect(
        validateSource(build({ type: "set", patch: { locationId: "1", sourceDescription } }))
      ).toEqual({});
    }
  });

  it("needs a supplier for external material", () => {
    const state = build(
      { type: "set", patch: { locationId: "1" } },
      { type: "setProviderMode", mode: "EXTERNAL" }
    );
    expect(validateSource(state).supplier?.code).toBe("supplier_required");
    expect(
      validateSource(wizardReducer(state, { type: "set", patch: { providerId: "5" } }))
    ).toEqual({});
  });

  it("needs no location without units, but the material source is always required", () => {
    expect(validateSource(build({ type: "removeGroup", key: "g0" }))).toEqual({});
    const external = build(
      { type: "removeGroup", key: "g0" },
      { type: "setProviderMode", mode: "EXTERNAL" }
    );
    expect(validateSource(external).supplier?.code).toBe("supplier_required");
  });
});

describe("validateReview", () => {
  it("requires an explicit override when the location would be over capacity", () => {
    const over = build(
      { type: "set", patch: { locationId: "1" } },
      { type: "updateGroup", key: "g0", patch: { quantity: "5", cultivarId: "3" } }
    );
    expect(validateReview(over, context).capacityOverride?.code).toBe("capacity_override_required");
    const accepted = wizardReducer(over, { type: "set", patch: { capacityOverride: true } });
    expect(validateReview(accepted, context)).toEqual({});
    const fits = wizardReducer(over, {
      type: "updateGroup",
      key: "g0",
      patch: { quantity: "2" },
    });
    expect(validateReview(fits, context)).toEqual({});
  });

  it("also asks when the server refused for capacity", () => {
    const state = build({ type: "set", patch: { locationId: "2" } });
    expect(validateReview(state, { ...context, capacityConflict: true })).toHaveProperty(
      "capacityOverride"
    );
  });
});

describe("whole form", () => {
  it("finds the first step that still has a problem", () => {
    expect(firstInvalidStep(valid(), context)).toBeNull();
    const noName = wizardReducer(valid(), { type: "set", patch: { name: "" } });
    expect(firstInvalidStep(noName, context)).toBe("identity");
    const noCultivar = wizardReducer(valid(), {
      type: "updateGroup",
      key: "g0",
      patch: { cultivarId: "" },
    });
    expect(firstInvalidStep(noCultivar, context)).toBe("units");
    const noLocation = wizardReducer(valid(), { type: "set", patch: { locationId: "" } });
    expect(firstInvalidStep(noLocation, context)).toBe("source");
    const all = validateAll(noLocation, context);
    expect(hasErrors(all.source)).toBe(true);
    expect(hasErrors(all.identity)).toBe(false);
  });
});
