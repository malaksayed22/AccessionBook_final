import { describe, expect, it } from "vitest";
import { buildUnitLedger, type LedgerSource } from "./ledger";

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes));

function source(overrides: Partial<LedgerSource> = {}): LedgerSource {
  return {
    unit: {
      name: "MOM",
      type: "PLANT",
      cultivarName: "Northern Lights",
      experimentCode: "AB1",
      sourceType: "RECEIVED",
      sourceParent: null,
    },
    states: [],
    derived: [],
    holds: [],
    activities: [],
    attachments: [],
    shipments: [],
    tests: [],
    incidents: [],
    audits: [],
    ...overrides,
  };
}

const state = (
  sequence: number,
  kind: LedgerSource["states"][number]["kind"],
  extra: Partial<LedgerSource["states"][number]> = {}
): LedgerSource["states"][number] => ({
  id: sequence * 10,
  sequence,
  kind,
  effectiveAt: at(sequence),
  recordedAt: at(sequence),
  recordedBy: "Member",
  locationName: "Room 1",
  growthStage: null,
  humidWeight: null,
  dryWeight: null,
  seedCount: null,
  organizationName: null,
  scanConfirmed: false,
  reason: null,
  witnessName: null,
  comment: null,
  parentStateId: null,
  parentUnit: null,
  ...extra,
});

describe("buildUnitLedger", () => {
  it("returns enum values and facts, never sentences, newest first", () => {
    const events = buildUnitLedger(
      source({
        states: [
          state(1, "CREATED"),
          state(2, "MOVED", { locationName: "Room 2", scanConfirmed: true }),
          state(3, "STAGE_CHANGED", { growthStage: "FLOWERING" }),
        ],
      })
    );
    expect(events.map((e) => e.type)).toEqual(["STAGE_CHANGED", "MOVED", "REGISTERED"]);
    expect(events[1]?.facts).toEqual({ from: "Room 1", to: "Room 2", scanConfirmed: true });
    expect(events[0]?.facts).toEqual({ from: null, to: "FLOWERING" });
    expect(events[0]?.actor).toBe("Member");
    expect(events[0]?.sequence).toBe(3);
  });

  it("keeps registration after the first event it belongs to", () => {
    const events = buildUnitLedger(
      source({ states: [state(1, "RECEIVED", { organizationName: "Supplier" })] })
    );
    expect(events.map((e) => e.type)).toEqual(["RECEIVED", "REGISTERED"]);
  });

  it("marks entries filed after the fact, and only those", () => {
    const events = buildUnitLedger(
      source({
        states: [
          state(1, "CREATED"),
          state(2, "STAGE_CHANGED", { growthStage: "FLOWERING", recordedAt: at(60) }),
        ],
      })
    );
    expect(events.find((e) => e.sequence === 2)?.recordedAt).toBe(at(60).toISOString());
    expect(events.find((e) => e.type === "REGISTERED")?.recordedAt).toBeNull();
  });

  it("covers holds (placed and released), incidents and documents with their author, not lab results", () => {
    const events = buildUnitLedger(
      source({
        states: [state(1, "CREATED")],
        holds: [
          {
            id: 1,
            kind: "HOLD",
            origin: "AUTO_INCIDENT",
            reason: "Auto-hold: critical incident",
            placedAt: at(10),
            placedBy: "Member",
            releasedAt: at(20),
            releasedBy: "Admin",
            releaseNote: "Retest passed",
          },
        ],
        tests: [
          {
            id: 1,
            panel: "POTENCY",
            analyte: "THC",
            value: 30,
            uom: "%",
            labName: "Lab A",
            comment: null,
            testedAt: at(9),
            createdAt: at(9),
            actor: "Member",
          },
        ],
        incidents: [
          {
            id: 1,
            title: "Mould",
            severity: "MAJOR",
            status: "OPEN",
            createdAt: at(11),
            actor: "Admin",
          },
        ],
        attachments: [
          {
            id: 1,
            label: "CoA",
            fileName: "coa.pdf",
            category: "COA",
            createdAt: at(12),
            actor: "Member",
          },
        ],
      })
    );
    const byType = Object.fromEntries(events.map((e) => [e.type, e]));
    expect(byType.HOLD_PLACED).toMatchObject({
      actor: "Member",
      note: "Auto-hold: critical incident",
    });
    expect(byType.HOLD_RELEASED).toMatchObject({ actor: "Admin", note: "Retest passed" });
    // Lab results are set aside for now, so a recorded test is not in the history.
    expect(byType.TEST).toBeUndefined();
    expect(byType.INCIDENT?.actor).toBe("Admin");
    expect(byType.ATTACHMENT?.facts).toEqual({ label: "CoA", category: "COA" });
    expect(events.every((e) => e.actor !== null)).toBe(true);
  });

  it("tells a partial flower shipment with the original, what left and what is left", () => {
    const events = buildUnitLedger(
      source({
        unit: { ...source().unit, type: "FLOWER" },
        states: [
          state(1, "CREATED", { humidWeight: 100, dryWeight: 25 }),
          state(2, "SHIPPED_PART", {
            humidWeight: 70,
            dryWeight: 25,
            shippedWeight: 30,
            shippedMoisture: "WET",
            organizationName: "Buyer",
          }),
          state(3, "SHIPPED_PART", {
            humidWeight: 45,
            dryWeight: 25,
            shippedWeight: 25,
            shippedMoisture: "WET",
            organizationName: "Other",
          }),
        ],
        shipments: [
          {
            shipmentId: 7,
            reference: "SH-1",
            direction: "OUTBOUND",
            status: "IN_TRANSIT",
            description: "Flower",
            stateId: 20,
            at: at(2),
            actor: "Admin",
          },
        ],
      })
    );
    const shipped = events.filter((e) => e.type === "SHIPPED");
    expect(shipped).toHaveLength(2);
    const [second, first] = shipped;
    expect(first?.facts).toMatchObject({
      measure: "weight",
      basis: "WET",
      original: 100,
      shipped: 30,
      totalShipped: 30,
      remaining: 70,
      final: false,
      organization: "Buyer",
      reference: "SH-1",
    });
    expect(first?.href).toBe("/inventory/materials/7");
    expect(second?.facts).toMatchObject({
      original: 100,
      shipped: 25,
      totalShipped: 55,
      remaining: 45,
      final: false,
    });
    // The shipment line that took from this unit is told by the unit's own shipped event.
    expect(events.some((e) => e.type === "SHIPMENT")).toBe(false);
  });

  it("marks the last shipment of a seed lot as final", () => {
    const events = buildUnitLedger(
      source({
        unit: { ...source().unit, type: "SEEDLOT" },
        states: [
          state(1, "CREATED", { seedCount: 50 }),
          state(2, "SHIPPED_PART", { seedCount: 20, shippedCount: 30 }),
          state(3, "SHIPPED", { seedCount: 0, shippedCount: 20 }),
        ],
      })
    );
    const last = events.find((e) => e.type === "SHIPPED" && e.sequence === 3);
    expect(last?.facts).toMatchObject({
      measure: "count",
      original: 50,
      shipped: 20,
      totalShipped: 50,
      remaining: 0,
      final: true,
    });
  });

  it("tells a whole shipment without quantities (a plant, or imported data)", () => {
    const events = buildUnitLedger(
      source({ states: [state(1, "CREATED"), state(2, "SHIPPED", { organizationName: "Buyer" })] })
    );
    const shipped = events.find((e) => e.type === "SHIPPED");
    expect(shipped?.facts).toMatchObject({ measure: "whole", organization: "Buyer" });
  });

  it("does not repeat a shipment as a separate SHIPPED event", () => {
    const events = buildUnitLedger(
      source({
        states: [state(1, "CREATED"), state(2, "SHIPPED", { organizationName: "Buyer" })],
        shipments: [
          {
            shipmentId: 7,
            reference: "SH-1",
            direction: "OUTBOUND",
            status: "IN_TRANSIT",
            description: "Plant",
            stateId: 20,
            at: at(2),
            actor: "Admin",
          },
        ],
      })
    );
    expect(events.map((e) => e.type).sort()).toEqual(["REGISTERED", "SHIPPED"]);
    expect(events.find((e) => e.type === "SHIPPED")?.href).toBe("/inventory/materials/7");
  });

  it("uses the audit entry for the date and author of a parent link made after registration", () => {
    const events = buildUnitLedger(
      source({
        unit: { ...source().unit, sourceParent: { id: 5, name: "MOTHER" } },
        states: [state(1, "CREATED")],
        audits: [
          {
            id: 1,
            action: "lineage",
            summary: "Linked parent MOTHER",
            reason: null,
            createdAt: at(30),
            actor: "Admin",
          },
          {
            id: 2,
            action: "update",
            summary: "Updated notes",
            reason: null,
            createdAt: at(40),
            actor: "Member",
          },
          {
            id: 3,
            action: "transfer",
            summary: "covered elsewhere",
            reason: null,
            createdAt: at(41),
            actor: "Member",
          },
        ],
      })
    );
    const link = events.find((e) => e.type === "LINEAGE_LINKED");
    expect(link).toMatchObject({
      actor: "Admin",
      at: at(30).toISOString(),
      href: "/inventory/units/5",
    });
    expect(events.filter((e) => e.type === "LINEAGE_LINKED")).toHaveLength(1);
    expect(events.find((e) => e.type === "AUDIT")).toMatchObject({
      facts: { action: "update" },
      note: "Updated notes",
    });
    expect(events.filter((e) => e.type === "AUDIT")).toHaveLength(1);
  });

  it("shows no lineage link when the unit was created from its parent's state", () => {
    const events = buildUnitLedger(
      source({
        unit: { ...source().unit, sourceParent: { id: 5, name: "MOTHER" } },
        states: [state(1, "CREATED", { parentStateId: 3, parentUnit: { id: 5, name: "MOTHER" } })],
      })
    );
    expect(events.map((e) => e.type).sort()).toEqual(["DERIVED_FROM", "REGISTERED"]);
  });
});
