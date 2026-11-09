import { describe, expect, it } from "vitest";
import { availabilityMap, availabilityOf, type UnitActionContext } from "./unit-actions";

const member: UnitActionContext = {
  type: "PLANT",
  terminal: null,
  onHold: false,
  hasParent: false,
  canEdit: true,
  isAdmin: false,
};
const admin: UnitActionContext = { ...member, isAdmin: true };
const viewer: UnitActionContext = { ...member, canEdit: false };
const quality: UnitActionContext = {
  ...member,
  canEdit: false,
  canRecordQuality: true,
  canReleaseHold: true,
};
const inspector: UnitActionContext = { ...viewer, canRecordQuality: false };

describe("roles on the unit page", () => {
  it("lets quality assurance hold, report and release, and nothing else", () => {
    const map = availabilityMap(quality);
    for (const action of ["hold", "reportIncident"] as const) {
      expect(map[action].status).toBe("allowed");
    }
    for (const action of ["move", "stage", "measure", "derive", "ship", "destroy"] as const) {
      expect(map[action].status).toBe("hidden");
    }
    expect(availabilityMap({ ...quality, onHold: true }).releaseHold.status).toBe("allowed");
    // An inventory manager edits the unit, but releasing a hold stays a quality decision.
    expect(availabilityMap({ ...member, onHold: true }).releaseHold.status).toBe("hidden");
  });

  it("sets lab results and samples aside for now, for everyone", () => {
    for (const context of [admin, member, quality]) {
      const map = availabilityMap({ ...context, type: "FLOWER" });
      expect(map.recordTest.status).toBe("hidden");
      expect(map.sample.status).toBe("hidden");
    }
  });

  it("locks a plant's weights once wet and dry are both on record, for everyone", () => {
    const weighed = { ...member, type: "FLOWER" as const, weights: { wet: true, dry: true } };
    expect(availabilityOf("measure", weighed)).toEqual({ status: "blocked", reason: "weighed" });
    // Only the wet weight is in: the dry weight can still be added after drying.
    expect(
      availabilityOf("measure", { ...weighed, weights: { wet: true, dry: false } }).status
    ).toBe("allowed");
    // Nobody adds a weight then, administrators included; members report a mistake as an incident.
    expect(availabilityOf("measure", { ...weighed, isAdmin: true })).toEqual({
      status: "blocked",
      reason: "weighed",
    });
    expect(availabilityOf("reportWeight", weighed).status).toBe("allowed");
    expect(availabilityOf("reportWeight", { ...weighed, isAdmin: true }).status).toBe("hidden");
    expect(
      availabilityOf("reportWeight", { ...weighed, weights: { wet: false, dry: false } }).status
    ).toBe("hidden");
    // Seed counts are not weights.
    expect(
      availabilityOf("measure", { ...member, type: "SEEDLOT", weights: { wet: true, dry: true } })
        .status
    ).toBe("allowed");
  });

  it("offers waste on weighed material only, and a hold blocks it", () => {
    expect(availabilityMap({ ...member, type: "FLOWER", weighed: true }).waste.status).toBe(
      "allowed"
    );
    expect(availabilityMap({ ...member, type: "PLANT", weighed: false }).waste.status).toBe(
      "hidden"
    );
    expect(
      availabilityMap({ ...member, type: "FLOWER", weighed: true, onHold: true }).waste
    ).toEqual({ status: "blocked", reason: "held" });
    expect(availabilityMap({ ...quality, type: "FLOWER", weighed: true }).waste.status).toBe(
      "hidden"
    );
  });

  it("splits only a group of two or more plants, merges any plant unit, and a hold blocks both", () => {
    expect(availabilityMap({ ...member, plants: 1 }).split.status).toBe("hidden");
    expect(availabilityMap({ ...member, plants: 40 }).split.status).toBe("allowed");
    expect(availabilityMap({ ...member, plants: 1 }).merge.status).toBe("allowed");
    expect(availabilityMap({ ...member, type: "FLOWER", plants: 40 }).split.status).toBe("hidden");
    expect(availabilityMap({ ...member, plants: 40, onHold: true }).split).toEqual({
      status: "blocked",
      reason: "held",
    });
  });

  it("offers an inspector nothing", () => {
    const map = availabilityMap(inspector);
    expect(Object.values(map).every((state) => state.status === "hidden")).toBe(true);
  });
});

describe("availabilityOf", () => {
  it("allows an experiment member to record on an active plant", () => {
    const map = availabilityMap(member);
    for (const action of [
      "move",
      "stage",
      "measure",
      "derive",
      "edit",
      "editDetails",
      "linkParent",
      "hold",
    ] as const) {
      expect(map[action].status, action).toBe("allowed");
    }
    // Destruction is final: administrators, and members of the unit's experiment.
    expect(map.destroy.status).toBe("hidden");
    expect(availabilityMap({ ...member, canDestroy: true }).destroy.status).toBe("allowed");
    expect(availabilityMap(admin).destroy.status).toBe("allowed");
  });

  it("hides everything from someone who cannot edit, release included", () => {
    const map = availabilityMap(viewer);
    expect(Object.values(map).every((a) => a.status === "hidden")).toBe(true);
  });

  it("lets only admins release a hold, and only when there is one", () => {
    expect(availabilityOf("releaseHold", { ...member, onHold: true }).status).toBe("hidden");
    expect(availabilityOf("releaseHold", { ...admin, onHold: false }).status).toBe("hidden");
    expect(availabilityOf("releaseHold", { ...admin, onHold: true }).status).toBe("allowed");
  });

  it("blocks custody and lifecycle actions during a hold but not records", () => {
    const held = { ...member, onHold: true };
    for (const action of ["move", "stage", "derive"] as const) {
      expect(availabilityOf(action, held), action).toEqual({ status: "blocked", reason: "held" });
    }
    for (const action of ["measure", "edit", "editDetails", "reportIncident", "upload"] as const) {
      expect(availabilityOf(action, held).status, action).toBe("allowed");
    }
    expect(availabilityOf("destroy", { ...admin, onHold: true })).toEqual({
      status: "blocked",
      reason: "held",
    });
    expect(availabilityOf("hold", held).status).toBe("hidden");
  });

  it("blocks every edit once the unit is destroyed or shipped and says why", () => {
    const destroyed = availabilityMap({ ...member, terminal: "DESTROYED" });
    expect(destroyed.move).toEqual({ status: "blocked", reason: "destroyed" });
    expect(destroyed.upload).toEqual({ status: "blocked", reason: "destroyed" });
    const shipped = availabilityMap({ ...admin, terminal: "SHIPPED" });
    expect(shipped.move).toEqual({ status: "blocked", reason: "shipped" });
    expect(shipped.edit).toEqual({ status: "blocked", reason: "shipped" });
  });

  it("keeps notes editable on a destroyed unit for admins only, and sex and stage not at all", () => {
    expect(availabilityOf("editDetails", { ...admin, terminal: "DESTROYED" })).toEqual({
      status: "blocked",
      reason: "destroyed",
    });
    expect(availabilityOf("edit", { ...admin, terminal: "DESTROYED" }).status).toBe("allowed");
    expect(availabilityOf("edit", { ...member, terminal: "DESTROYED" }).status).toBe("hidden");
  });

  it("applies unit-type rules", () => {
    expect(availabilityOf("stage", { ...member, type: "SEEDLOT" }).status).toBe("hidden");
    expect(availabilityOf("measure", { ...member, type: "CULTURE" }).status).toBe("hidden");
    expect(availabilityOf("derive", { ...member, type: "FLOWER" }).status).toBe("hidden");
    expect(availabilityOf("derive", { ...member, type: "CULTURE" }).status).toBe("allowed");
  });

  it("offers the parent link only once", () => {
    expect(availabilityOf("linkParent", { ...member, hasParent: true }).status).toBe("hidden");
  });
});

describe("ship", () => {
  it("is an administrator's custody record, frozen by a hold and closed once nothing is left", () => {
    expect(availabilityOf("ship", member).status).toBe("hidden");
    expect(availabilityOf("ship", admin).status).toBe("allowed");
    expect(availabilityOf("ship", { ...admin, onHold: true })).toEqual({
      status: "blocked",
      reason: "held",
    });
    expect(availabilityOf("ship", { ...admin, terminal: "SHIPPED" })).toEqual({
      status: "blocked",
      reason: "shipped",
    });
  });
});
