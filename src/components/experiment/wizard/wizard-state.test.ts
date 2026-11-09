import { describe, expect, it } from "vitest";
import {
  blankGroup,
  buildPayload,
  checkCapacity,
  initialState,
  parseDraft,
  plannedUnits,
  serializeDraft,
  wizardReducer,
  type WizardState,
} from "./wizard-state";

const seed = { today: "2026-03-04" };
// A wizard whose first entry is a group, so quantities and splits can be exercised.
const fresh = () => ({ ...initialState(seed), groups: [blankGroup(0, "PLANTS", true)] });

describe("initialState", () => {
  it("starts on today with no code fields, an optional estimate and one single unit", () => {
    const state = initialState(seed);
    expect(state).toMatchObject({
      startDate: "2026-03-04",
      estimatedEndDate: "",
      providerMode: "INTERNAL",
      createReceipt: false,
    });
    expect(state).not.toHaveProperty("endDate");
    expect(state).not.toHaveProperty("codePrefix");
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toMatchObject({
      kind: "PLANTS",
      isGroup: false,
      quantity: "1",
      // No default: the starting status is a choice the person must make.
      status: "",
    });
  });

  it("adds a group with its own quantity on request, and a single unit separately", () => {
    let state = wizardReducer(fresh(), { type: "addGroup" });
    expect(state.groups[1]).toMatchObject({ isGroup: true, quantity: "1" });
    state = wizardReducer(state, { type: "addUnit" });
    expect(state.groups[2]).toMatchObject({ isGroup: false });
  });

  it("always sends a single unit as one unit, whatever its leftover fields say", () => {
    const single = initialState(seed);
    const state = wizardReducer(single, {
      type: "updateGroup",
      key: "g0",
      patch: { quantity: "9", cultivarMode: "MIXED", statusMode: "MIXED", cultivarId: "2" },
    });
    expect(buildPayload(state, { admin: false }).unitGroups[0]).toMatchObject({
      quantity: 1,
      cultivarMode: "SAME",
      statusMode: "SAME",
    });
  });

  it("pre-fills from a source unit", () => {
    const state = initialState({
      ...seed,
      parentExperimentId: 7,
      sourceUnit: {
        kind: "SEEDS",
        cultivarId: 4,
        growthStage: null,
        locationId: 2,
        providerMode: "EXTERNAL",
        providerOrganizationId: 9,
        sourceDescription: null,
      },
    });
    expect(state).toMatchObject({
      parentExperimentId: "7",
      locationId: "2",
      providerMode: "EXTERNAL",
      providerId: "9",
      createReceipt: true,
    });
    expect(state.groups[0]).toMatchObject({ kind: "SEEDS", cultivarId: "4" });
    expect(state.nextGroupNumber).toBe(1);
  });
});

describe("wizardReducer", () => {
  it("adds, updates and removes unit groups with stable keys", () => {
    let state = fresh();
    state = wizardReducer(state, { type: "addGroup" });
    state = wizardReducer(state, { type: "addGroup" });
    expect(state.groups.map((g) => g.key)).toEqual(["g0", "g1", "g2"]);
    state = wizardReducer(state, { type: "removeGroup", key: "g1" });
    state = wizardReducer(state, { type: "addGroup" });
    expect(state.groups.map((g) => g.key)).toEqual(["g0", "g2", "g3"]);
    state = wizardReducer(state, { type: "updateGroup", key: "g2", patch: { quantity: "5" } });
    expect(state.groups[1]?.quantity).toBe("5");
    state = wizardReducer(state, { type: "removeGroup", key: "g0" });
    state = wizardReducer(state, { type: "removeGroup", key: "g2" });
    state = wizardReducer(state, { type: "removeGroup", key: "g3" });
    expect(state.groups).toEqual([]);
  });

  it("resets status when the material type changes", () => {
    let state = fresh();
    state = wizardReducer(state, {
      type: "updateGroup",
      key: "g0",
      patch: { statusMode: "MIXED", breakdown: { VEGETATIVE: "1" }, status: "FLOWERING" },
    });
    state = wizardReducer(state, { type: "changeKind", key: "g0", kind: "FLOWERS" });
    expect(state.groups[0]).toMatchObject({
      kind: "FLOWERS",
      status: "",
      statusMode: "SAME",
      breakdown: {},
    });
    state = wizardReducer(state, { type: "changeKind", key: "g0", kind: "SEEDS" });
    expect(state.groups[0]?.status).toBe("");
  });

  it("switching to internal stock drops the supplier and the receipt", () => {
    let state = wizardReducer(fresh(), { type: "setProviderMode", mode: "EXTERNAL" });
    expect(state).toMatchObject({ providerMode: "EXTERNAL", createReceipt: true });
    state = wizardReducer(state, { type: "set", patch: { providerId: "3" } });
    state = wizardReducer(state, { type: "setProviderMode", mode: "INTERNAL" });
    expect(state).toMatchObject({ providerMode: "INTERNAL", providerId: "", createReceipt: false });
  });
});

describe("buildPayload", () => {
  it("converts typed text to the API shape and drops empty optionals", () => {
    let state: WizardState = fresh();
    state = wizardReducer(state, {
      type: "set",
      patch: {
        name: "  Photoperiod  ",
        comment: "  ",
        locationId: "3",
        sourceDescription: "  Internal mother room stock  ",
        memberIds: [5, 6],
      },
    });
    state = wizardReducer(state, {
      type: "updateGroup",
      key: "g0",
      patch: { kind: "CLONES", quantity: "4", cultivarId: "2", status: "VEGETATIVE" },
    });
    const payload = buildPayload(state, { admin: true, sourceUnitId: 11 });
    expect(payload).not.toHaveProperty("endDate");
    expect(payload).not.toHaveProperty("codePrefix");
    expect(payload).toMatchObject({
      name: "Photoperiod",
      comment: undefined,
      locationId: 3,
      providerMode: "INTERNAL",
      providerOrganizationId: null,
      sourceDescription: "Internal mother room stock",
      createReceipt: false,
      sourceUnitId: 11,
      memberIds: [5, 6],
      ignoreCapacityWarning: false,
    });
    expect(payload.unitGroups).toEqual([
      expect.objectContaining({ kind: "CLONES", cultivarId: 2, quantity: 4, status: "VEGETATIVE" }),
    ]);
  });

  it("sends members only for administrators, and supplier and receipt only when external", () => {
    let state = wizardReducer(fresh(), { type: "set", patch: { memberIds: [5], providerId: "9" } });
    expect(buildPayload(state, { admin: false }).memberIds).toBeUndefined();
    expect(buildPayload(state, { admin: false })).toMatchObject({
      providerOrganizationId: null,
      createReceipt: false,
    });
    state = wizardReducer(state, { type: "setProviderMode", mode: "EXTERNAL" });
    state = wizardReducer(state, {
      type: "set",
      patch: { providerId: "9" },
    });
    expect(buildPayload(state, { admin: false })).toMatchObject({
      providerOrganizationId: 9,
      createReceipt: true,
    });
  });

  it("keeps mixed breakdowns and only the weights the material tracks", () => {
    let state = wizardReducer(fresh(), { type: "changeKind", key: "g0", kind: "FLOWERS" });
    state = wizardReducer(state, {
      type: "updateGroup",
      key: "g0",
      patch: {
        quantity: "5",
        cultivarMode: "MIXED",
        cultivarBreakdown: { "2": "3", "4": "2", "6": "0" },
        statusMode: "MIXED",
        breakdown: { HARVESTED: "5", DRYING: "" },
        wetWeightGrams: "12.5",
        seedsPerLot: "100",
      },
    });
    const [group] = buildPayload(state, { admin: false }).unitGroups;
    expect(group).toMatchObject({
      cultivarBreakdown: [
        { cultivarId: 2, count: 3 },
        { cultivarId: 4, count: 2 },
      ],
      breakdown: [{ status: "HARVESTED", count: 5 }],
      wetWeightGrams: 12.5,
      dryWeightGrams: null,
      seedsPerLot: null,
    });
  });

  it("counts planned units across groups", () => {
    let state = wizardReducer(fresh(), { type: "addGroup" });
    state = wizardReducer(state, { type: "updateGroup", key: "g0", patch: { quantity: "4" } });
    state = wizardReducer(state, { type: "updateGroup", key: "g1", patch: { quantity: "x" } });
    expect(plannedUnits(state)).toBe(4);
  });
});

describe("checkCapacity", () => {
  it("is unlimited without a capacity or without units", () => {
    expect(checkCapacity(null, 5)).toEqual({ status: "unlimited" });
    expect(checkCapacity({ capacity: null, occupancy: 3 }, 5)).toEqual({ status: "unlimited" });
    expect(checkCapacity({ capacity: 10, occupancy: 3 }, 0)).toEqual({ status: "unlimited" });
  });

  it("tells within, full and exceeded apart", () => {
    expect(checkCapacity({ capacity: 10, occupancy: 3 }, 5)).toMatchObject({
      status: "within",
      projected: 8,
    });
    expect(checkCapacity({ capacity: 10, occupancy: 5 }, 5)).toMatchObject({ status: "full" });
    expect(checkCapacity({ capacity: 10, occupancy: 6 }, 5)).toMatchObject({
      status: "exceeded",
      projected: 11,
    });
  });
});

describe("draft", () => {
  it("round-trips and never carries a capacity override", () => {
    const state = wizardReducer(fresh(), {
      type: "set",
      patch: { name: "Draft", capacityOverride: true },
    });
    const draft = parseDraft(serializeDraft("units", state));
    expect(draft?.step).toBe("units");
    expect(draft?.state.name).toBe("Draft");
    expect(draft?.state.capacityOverride).toBe(false);
  });

  it("rejects anything that is not a current draft", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 0, step: "units", state: {} }))).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 2, step: "nowhere", state: fresh() }))).toBeNull();
    const broken = { ...fresh(), groups: [{ key: "g0", kind: "UNKNOWN" }] };
    expect(parseDraft(JSON.stringify({ version: 2, step: "units", state: broken }))).toBeNull();
  });
});

describe("blankGroup", () => {
  it("starts with no status chosen, whatever the material", () => {
    expect(blankGroup(3, "FLOWERS")).toMatchObject({ key: "g3", status: "" });
    expect(blankGroup(0, "CULTURES").status).toBe("");
  });
});
