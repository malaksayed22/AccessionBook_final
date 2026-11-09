import { describe, expect, it } from "vitest";
import { classifyChainFailure } from "./chain";
import { auditEntityHref, isKnownAction, isKnownEntityType } from "./links";

describe("classifyChainFailure", () => {
  it("maps the database wording to a code the screen translates", () => {
    expect(classifyChainFailure("sequence gap or reorder (expected 3)")).toBe("sequenceGap");
    expect(
      classifyChainFailure(
        "previous-hash link broken (a row before this one was altered or removed)"
      )
    ).toBe("linkBroken");
    expect(classifyChainFailure("row content does not match its hash (row was altered)")).toBe(
      "contentAltered"
    );
    expect(classifyChainFailure("something else entirely")).toBe("unknown");
  });
});

describe("auditEntityHref", () => {
  it("links the record types that have a page", () => {
    expect(auditEntityHref("unit", 7)).toBe("/inventory/units/7");
    expect(auditEntityHref("experiment", 2)).toBe("/inventory/experiments/2");
    expect(auditEntityHref("member", 3)).toBe("/records/members/3");
    expect(auditEntityHref("organization", 4)).toBe("/records/organizations/4");
    expect(auditEntityHref("shipment", 5)).toBe("/inventory/materials/5");
  });

  it("does not invent a link", () => {
    expect(auditEntityHref("settings", 1)).toBeNull();
    expect(auditEntityHref("auth", 1)).toBeNull();
    expect(auditEntityHref("unit", 0)).toBeNull();
    expect(auditEntityHref("unit", -4)).toBeNull();
    expect(auditEntityHref("mystery", 9)).toBeNull();
  });

  it("recognises the vocabulary it can translate", () => {
    expect(isKnownAction("stage_transition")).toBe(true);
    expect(isKnownAction("rm -rf")).toBe(false);
    expect(isKnownEntityType("auth")).toBe(true);
    expect(isKnownEntityType("toString")).toBe(false);
  });
});
