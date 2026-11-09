import { beforeAll, describe, expect, it } from "vitest";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";
import {
  GrowthStage,
  HoldKind,
  SourceType,
  TestPanel,
  UnitStateKind,
} from "@/generated/prisma/enums";
import {
  changeStage,
  deriveUnits,
  destroyUnit,
  measureUnit,
  moveUnit,
} from "@/features/unit/service";
import { getRecallTrace } from "@/features/qa/queries";
import { placeHold, recordLabTest, voidLabTest } from "@/features/qa/service";
import { runComplianceChecks } from "@/features/compliance/queries";
import { zonedDateKey, startOfZonedDay } from "@/lib/lab-time";
import { getOrganizationDetail } from "@/features/organization/queries";
import { summarizeStageDurations } from "@/lib/stage-durations";
import { getUnitLedger, getUnitProfile, getUnitStates } from "@/features/unit/queries";
import { createLab, registerOne, resetDatabase } from "./helpers";

// The lab is in Toronto: every date below is a Toronto calendar day.
const LAB_TIMEZONE = "America/Toronto";
process.env.LAB_TIMEZONE = LAB_TIMEZONE;

/** The lab's calendar day `days` days ago: calendar days, so a clock change never shifts it. */
const daysAgoKey = (days: number) => {
  const [y, m, d] = zonedDateKey(new Date(), LAB_TIMEZONE).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - days)).toISOString().slice(0, 10);
};

/**
 * One small lab, built only through the real services:
 *
 *   MOM (received from a supplier, registered 40 days ago, flowering since day -20, harvested since
 *   day -5, then moved to Room 2 and weighed) is cut three times (two batches); one clone is cut again.
 *   MOM-CL-2 is on hold, MOM-CL-3 is destroyed, HARVEST-NOWEIGHT is harvested without a weight.
 */
describe("read models", () => {
  type Lab = Awaited<ReturnType<typeof createLab>>;
  let lab: Lab;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();

    const mom = await registerOne(lab, {
      name: "MOM",
      effectiveAt: daysAgoKey(40),
      sourceType: SourceType.RECEIVED,
      sourceDescription: undefined,
      providerOrganizationId: lab.provider.id,
    });
    ids.MOM = mom.id;

    const firstBatch = await deriveUnits(lab.member, mom.id, { deriveType: "clone", quantity: 2 });
    const secondBatch = await deriveUnits(lab.member, mom.id, { deriveType: "clone", quantity: 1 });
    expect([...firstBatch.units, ...secondBatch.units].map((u) => u.name)).toEqual([
      "MOM-CL-1",
      "MOM-CL-2",
      "MOM-CL-3",
    ]);
    for (const unit of [...firstBatch.units, ...secondBatch.units]) ids[unit.name] = unit.id;

    const grandchild = await deriveUnits(lab.member, ids["MOM-CL-1"]!, {
      deriveType: "cutting",
      quantity: 1,
    });
    ids.GRANDCHILD = grandchild.units[0]!.id;

    await changeStage(lab.member, mom.id, {
      toStage: GrowthStage.FLOWERING,
      effectiveAt: daysAgoKey(20),
    });
    await changeStage(lab.member, mom.id, {
      toStage: GrowthStage.HARVESTED,
      effectiveAt: daysAgoKey(5),
    });
    await moveUnit(lab.member, mom.id, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await measureUnit(lab.member, mom.id, { humidWeight: 100.5, dryWeight: 25 });

    await placeHold(lab.admin, ids["MOM-CL-2"]!, {
      reason: "Suspected mites",
      kind: HoldKind.HOLD,
    });
    await destroyUnit(lab.admin, ids["MOM-CL-3"]!, {
      reason: "Mites",
    });

    const unweighed = await registerOne(lab, {
      name: "HARVEST-NOWEIGHT",
      growthStage: GrowthStage.HARVESTED,
    });
    ids.NOWEIGHT = unweighed.id;
    const other = await registerOne(lab, { name: "OTHER-PLANT" });
    ids.OTHER = other.id;
  });

  describe("getUnitProfile", () => {
    it("assembles the current state, weights as numbers, provider and lineage", async () => {
      const profile = await getUnitProfile(lab.admin, ids.MOM!);
      if (!profile) throw new Error("profile missing");

      expect(profile.name).toBe("MOM");
      expect(profile.current).toMatchObject({
        kind: UnitStateKind.MEASURED,
        growthStage: GrowthStage.HARVESTED,
        humidWeight: 100.5,
        dryWeight: 25,
        locationName: "Room 2",
      });
      expect(typeof profile.current?.humidWeight).toBe("number");
      expect(profile.terminal).toBeNull();
      expect(profile.destruction).toBeNull();
      expect(profile.stage).toBe("HARVESTED");
      expect(profile.material).toBe("RECEIVED");
      expect(profile.source.provider?.name).toBe("Seed Supplier Inc.");
      expect(profile.parent).toBeNull();
      expect(profile.children.map((c) => c.name)).toEqual(["MOM-CL-1", "MOM-CL-2", "MOM-CL-3"]);
      expect(profile.weights).toMatchObject({ humid: 100.5, dry: 25, isHarvested: true });
      expect(profile.weights.changedAt).toEqual(profile.current?.effectiveAt);
      expect(profile.experimentChain.map((e) => e.ecode)).toEqual(["AB1"]);
      expect(profile.experiment?.leadName).toBe("Member");
      expect(profile.hold).toBeNull();
      expect(() => JSON.stringify(profile)).not.toThrow();
    });

    it("exposes the active hold with who placed it", async () => {
      const profile = await getUnitProfile(lab.admin, ids["MOM-CL-2"]!);
      expect(profile).toMatchObject({
        status: "on-hold",
        material: "CUTTING",
        hold: { kind: HoldKind.HOLD, reason: "Suspected mites", placedBy: "Admin" },
      });
      expect(profile?.hold?.placedAt).toBeInstanceOf(Date);
      expect(profile?.parent?.name).toBe("MOM");
    });

    it("reports a destroyed unit with its reason and who recorded it", async () => {
      const profile = await getUnitProfile(lab.admin, ids["MOM-CL-3"]!);
      expect(profile).toMatchObject({
        status: "destroyed",
        terminal: "DESTROYED",
        stage: null,
        destruction: { reason: "Mites", witness: null, recordedBy: "Admin" },
      });
      expect(profile?.destruction?.at).toEqual(profile?.current?.effectiveAt);
    });

    it("returns null for an unknown unit", async () => {
      expect(await getUnitProfile(lab.admin, 999_999)).toBeNull();
    });
  });

  describe("traceability", () => {
    it("walks the ancestry of a cutting of a cutting", async () => {
      const profile = await getUnitProfile(lab.admin, ids.GRANDCHILD!);
      const lineage = profile!.lineage;
      expect(lineage.ancestry.map((a) => a.name)).toEqual(["MOM", "MOM-CL-1"]);
      expect(lineage.mother?.name).toBe("MOM");
      expect(lineage.parent?.name).toBe("MOM-CL-1");
      expect(lineage.generation).toBe(2);
    });

    it("gives a mother plant no ancestry", async () => {
      expect((await getUnitProfile(lab.admin, ids.MOM!))!.lineage).toEqual({
        parent: null,
        mother: null,
        ancestry: [],
        generation: 0,
      });
    });

    it("rebuilds the location history from the MOVED events", async () => {
      const history = (await getUnitProfile(lab.admin, ids.MOM!))!.locationHistory;
      expect(history.stays.map((s) => s.locationName)).toEqual(["Room 1", "Room 2"]);
      expect(history.stays[0]?.days).toBeGreaterThanOrEqual(39);
      expect(history.stays[0]?.days).toBeLessThanOrEqual(41);
      expect(history.stays[1]).toMatchObject({ current: true, to: null, movedBy: "Member" });
      expect(history.totalMoves).toBe(1);
      expect(history.distinctLocations).toBe(2);
    });
  });

  describe("recall", () => {
    it("traces every cutting of a mother cut several times, without consuming her", async () => {
      const recall = await getRecallTrace(lab.admin, ids.MOM!);
      if (!recall) throw new Error("recall missing");

      // Depth first: each cutting is followed by its own cuttings.
      expect(recall.downstream.map((n) => [n.name, n.generation])).toEqual([
        ["MOM-CL-1", 1],
        ["MOM-CL-1-CL-1", 2],
        ["MOM-CL-2", 1],
        ["MOM-CL-3", 1],
      ]);
      expect(recall.counts).toMatchObject({ upstream: 0, downstream: 4, onHold: 1, destroyed: 1 });
      expect(recall.downstream.find((n) => n.name === "MOM-CL-2")?.hold?.kind).toBe(HoldKind.HOLD);
      expect(recall.downstream.find((n) => n.name === "MOM-CL-3")?.standing).toBe("destroyed");
      expect(recall.origin).toMatchObject({ name: "MOM", hold: null, relation: "self" });

      // Remaining active inventory of the same cultivar that is not already in the tree.
      expect(recall.sameCultivar.map((n) => n.name).sort()).toEqual([
        "HARVEST-NOWEIGHT",
        "OTHER-PLANT",
      ]);
    });

    it("traces back to the mother from a cutting of a cutting", async () => {
      const recall = await getRecallTrace(lab.admin, ids.GRANDCHILD!);
      expect(recall?.upstream.map((n) => [n.name, n.generation])).toEqual([
        ["MOM", -2],
        ["MOM-CL-1", -1],
      ]);
    });

    it("flags a held unit as the origin", async () => {
      const recall = await getRecallTrace(lab.admin, ids["MOM-CL-2"]!);
      expect(recall?.origin).toMatchObject({
        name: "MOM-CL-2",
        standing: "on-hold",
        hold: { kind: HoldKind.HOLD, reason: "Suspected mites" },
      });
    });

    it("returns null for an unknown unit", async () => {
      expect(await getRecallTrace(lab.admin, 999_999)).toBeNull();
    });
  });

  describe("stage durations", () => {
    const now = startOfZonedDay(zonedDateKey(new Date(), LAB_TIMEZONE), LAB_TIMEZONE);

    it("measures each stage from the effective dates of the stage events", async () => {
      const summary = summarizeStageDurations(await getUnitStates(lab.admin, ids.MOM!), { now });

      expect(summary.spans.map((s) => [s.stage, s.days, s.ongoing])).toEqual([
        ["VEGETATIVE", 20, false],
        ["FLOWERING", 15, false],
        ["HARVESTED", 5, true],
      ]);
      expect(summary.current?.stage).toBe("HARVESTED");
      expect(summary.totalDays).toBe(40);
    });

    it("stops the clock when the unit is destroyed", async () => {
      const profile = await getUnitProfile(lab.admin, ids["MOM-CL-3"]!);
      expect(profile!.stageDurations.current).toBeNull();
      expect(profile!.stageDurations.totalDays).toBeLessThanOrEqual(1);
    });
  });

  describe("ledger", () => {
    const types = (events: Array<{ type: string }>) => events.map((e) => e.type);

    it("lists the unit's own events, derived units and hold history", async () => {
      const events = await getUnitLedger(lab.admin, ids.MOM!);
      const kinds = types(events);
      expect(kinds.filter((k) => k === "PRODUCED")).toHaveLength(3);
      expect(kinds.filter((k) => k === "STAGE_CHANGED")).toHaveLength(2);
      expect(kinds).toEqual(
        expect.arrayContaining(["REGISTERED", "RECEIVED", "MOVED", "MEASURED"])
      );
      expect(events.find((e) => e.type === "MOVED")?.facts).toMatchObject({
        from: "Room 1",
        to: "Room 2",
      });
      // Newest first.
      const times = events.map((e) => new Date(e.at).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("links a cutting to its parent and shows the hold and the destruction", async () => {
      const grandchild = await getUnitLedger(lab.admin, ids.GRANDCHILD!);
      expect(grandchild.find((e) => e.type === "DERIVED_FROM")).toMatchObject({
        facts: { parent: "MOM-CL-1" },
        href: `/inventory/units/${ids["MOM-CL-1"]}`,
      });
      const held = await getUnitLedger(lab.admin, ids["MOM-CL-2"]!);
      expect(held.find((e) => e.type === "HOLD_PLACED")).toMatchObject({
        facts: { holdKind: "HOLD", holdOrigin: "MANUAL" },
        note: "Suspected mites",
        actor: "Admin",
      });
      const destroyed = await getUnitLedger(lab.admin, ids["MOM-CL-3"]!);
      expect(destroyed.find((e) => e.type === "DESTROYED")).toMatchObject({
        facts: { witness: null },
        note: "Mites",
      });
    });

    it("leaves voided lab tests out (and every test while lab results are set aside)", async () => {
      const unitId = ids.OTHER!;
      await recordLabTest(lab.member, unitId, {
        panel: TestPanel.POTENCY,
        analyte: "THC",
        value: 15,
      });
      const voided = await recordLabTest(lab.member, unitId, {
        panel: TestPanel.TERPENES,
        analyte: "Limonene",
        value: 1,
      });
      await voidLabTest(lab.admin, voided.testId, { reason: "Entered on the wrong unit" });

      const tests = (await getUnitLedger(lab.admin, unitId)).filter((e) => e.type === "TEST");
      // While lab results are set aside, none is in the history; once shown, only the kept one is.
      expect(tests).toHaveLength(LAB_RESULTS_SHOWN ? 1 : 0);
      if (LAB_RESULTS_SHOWN) {
        expect(tests[0]?.facts.analyte).toBe("THC");
        expect(tests[0]?.facts).not.toHaveProperty("verdict");
      }
    });
  });

  describe("compliance", () => {
    it("re-expresses the readiness checks on the new model", async () => {
      const report = await runComplianceChecks();
      const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));

      expect(byId["inventory-located"]).toMatchObject({ passing: true, count: 0 });
      expect(byId["destruction-documented"]).toMatchObject({ passing: true });
      expect(byId["destruction-filed-promptly"]).toMatchObject({ passing: true });
      expect(byId["quality-holds"]).toMatchObject({ count: 1, passing: false });
      expect(byId["quality-holds"]?.offenders[0]).toMatchObject({
        label: "MOM-CL-2",
        detail: { key: "hold", params: { kind: "HOLD", reason: "Suspected mites" } },
      });
      // Harvested plants carry a weight, except the one registered without.
      expect(byId["harvest-weights"]?.count).toBe(1);
      expect(byId["harvest-weights"]?.offenders[0]?.label).toBe("HARVEST-NOWEIGHT");
      // Every move so far was recorded without a barcode scan.
      expect(byId["transfers-scanned"]?.count).toBe(1);
      expect(report.findings).toHaveLength(12);
    });
  });

  describe("organization profile", () => {
    it("lists the units the supplier provided and its receipts", async () => {
      const detail = await getOrganizationDetail(lab.admin, lab.provider.id, {
        inbound: 1,
        outbound: 1,
        units: 1,
        tests: 1,
      });
      expect(detail?.units.rows.map((u) => u.name)).toEqual(["MOM"]);
      expect(detail?.counts).toMatchObject({ suppliedUnits: 1, unitsReceived: 1, unitsShipped: 0 });
    });
  });
});
