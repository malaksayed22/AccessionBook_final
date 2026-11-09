import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  ACTIONS,
  AUDIT_ACTION_KEYS,
  auditActionKey,
  availableActions,
  deriveKindsFor,
  groupActions,
  isActionAvailable,
  findAction,
  type AvailabilityInput,
  type UnitFacts,
} from "./action-catalog";

const unit = (overrides: Partial<UnitFacts> = {}): UnitFacts => ({
  type: "PLANT",
  status: "active",
  canEdit: true,
  ...overrides,
});

const ids = (input: AvailabilityInput) => availableActions(input).map((a) => a.id);

describe("catalogue", () => {
  it("has exactly one definition per action id", () => {
    expect(ACTIONS.map((a) => a.id).sort()).toEqual([...ACTION_IDS].sort());
  });

  it("has a title and description in both languages for every action and category", () => {
    for (const locale of ["en", "fr"]) {
      const messages = JSON.parse(
        readFileSync(
          path.resolve(import.meta.dirname, `../../messages/${locale}/actions.json`),
          "utf8"
        )
      );
      for (const action of ACTIONS) {
        expect(messages.items[action.id]?.title, `${locale} ${action.id}`).toBeTruthy();
        expect(messages.items[action.id]?.description, `${locale} ${action.id}`).toBeTruthy();
        expect(messages.done[action.id], `${locale} done ${action.id}`).toBeTruthy();
        expect(messages.categories[action.category], `${locale} ${action.category}`).toBeTruthy();
      }
      for (const key of AUDIT_ACTION_KEYS) expect(messages.audit[key], key).toBeTruthy();
    }
  });
});

describe("availability: global scope", () => {
  it("offers new experiment to everyone", () => {
    expect(ids({ scope: "global", isAdmin: false })).toContain("new_experiment");
  });

  it("offers registering and receiving only to people who belong to an experiment, or admins", () => {
    expect(ids({ scope: "global", isAdmin: false, hasExperiments: false })).toEqual([
      "new_experiment",
    ]);
    expect(ids({ scope: "global", isAdmin: false, hasExperiments: true })).toEqual([
      "new_experiment",
      "register_units",
      "receive_units",
    ]);
    expect(ids({ scope: "global", isAdmin: true })).toContain("register_units");
  });

  it("never offers unit actions outside a unit", () => {
    expect(ids({ scope: "global", isAdmin: true })).not.toContain("destroy");
  });
});

describe("availability: experiment scope", () => {
  it("offers register and receive only when the person may edit the experiment", () => {
    expect(ids({ scope: "experiment", isAdmin: false, canEditExperiment: true })).toContain(
      "register_units"
    );
    expect(ids({ scope: "experiment", isAdmin: false, canEditExperiment: false })).toEqual([
      "new_experiment",
    ]);
  });
});

describe("availability: unit scope", () => {
  it("offers lifecycle and custody actions on an active plant to an editor, but not admin-only ones", () => {
    const offered = ids({ scope: "unit", isAdmin: false, unit: unit() });
    expect(offered).toEqual(
      expect.arrayContaining([
        "derive",
        "change_stage",
        "measure",
        "move",
        "place_hold",
        "log_activity",
      ])
    );
    expect(offered).not.toContain("ship");
    expect(offered).not.toContain("release_hold");
    // Destruction is final, but members of the experiment record it too.
    expect(offered).toContain("destroy");
  });

  it("offers nothing to a person who cannot edit the unit", () => {
    expect(ids({ scope: "unit", isAdmin: false, unit: unit({ canEdit: false }) })).toEqual([]);
  });

  it("lets admins ship and destroy, and release only while a hold exists", () => {
    expect(ids({ scope: "unit", isAdmin: true, unit: unit() })).toContain("ship");
    expect(ids({ scope: "unit", isAdmin: true, unit: unit() })).toContain("destroy");
    expect(ids({ scope: "unit", isAdmin: true, unit: unit() })).not.toContain("release_hold");
    expect(ids({ scope: "unit", isAdmin: true, unit: unit({ status: "on-hold" }) })).toContain(
      "release_hold"
    );
  });

  it("blocks moving, deriving, restaging, shipping and destroying while on hold, but not records", () => {
    const held = ids({ scope: "unit", isAdmin: true, unit: unit({ status: "on-hold" }) });
    for (const blocked of ["move", "derive", "change_stage", "ship", "destroy", "place_hold"]) {
      expect(held).not.toContain(blocked);
    }
    expect(held).toEqual(
      expect.arrayContaining(["measure", "log_activity", "attach_file", "release_hold"])
    );
  });

  it("offers nothing once the unit is destroyed or has nothing left to act on", () => {
    expect(ids({ scope: "unit", isAdmin: true, unit: unit({ status: "destroyed" }) })).toEqual([]);
    expect(ids({ scope: "unit", isAdmin: true, unit: unit({ nothingLeft: true }) })).toEqual([]);
  });

  it("still offers actions on a unit that shipped part of itself", () => {
    expect(ids({ scope: "unit", isAdmin: true, unit: unit() })).toContain("ship");
  });

  it("limits actions by unit type", () => {
    const seedLot = ids({ scope: "unit", isAdmin: true, unit: unit({ type: "SEEDLOT" }) });
    expect(seedLot).toContain("measure");
    expect(seedLot).not.toContain("change_stage");
    expect(seedLot).not.toContain("derive");
    const culture = ids({ scope: "unit", isAdmin: true, unit: unit({ type: "CULTURE" }) });
    expect(culture).toContain("derive");
    expect(culture).not.toContain("measure");
  });

  it("offers nothing in unit scope without unit facts", () => {
    expect(
      isActionAvailable(findAction("move"), { scope: "unit", isAdmin: true, unit: null })
    ).toBe(false);
  });
});

describe("grouping and helpers", () => {
  it("groups in display order and drops empty categories", () => {
    const groups = groupActions(availableActions({ scope: "global", isAdmin: true }));
    expect(groups.map((g) => g.category)).toEqual(["create"]);
    const unitGroups = groupActions(
      availableActions({ scope: "unit", isAdmin: true, unit: unit() })
    );
    expect(unitGroups.map((g) => g.category)).toEqual([
      "create",
      "lifecycle",
      "custody",
      "quality",
      "records",
    ]);
  });

  it("knows which derivations each type supports (same rule as the service)", () => {
    expect(deriveKindsFor("PLANT")).toEqual(["clone", "cutting", "subculture"]);
    expect(deriveKindsFor("CULTURE")).toEqual(["subculture"]);
    expect(deriveKindsFor("SEEDLOT")).toEqual([]);
  });

  it("maps audit actions to keys and ignores unknown ones", () => {
    expect(auditActionKey("transfer")).toBe("transfer");
    expect(auditActionKey("something_new")).toBeNull();
  });
});
