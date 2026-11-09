import { beforeAll, describe, expect, it } from "vitest";
import { GrowthStage, SourceType, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import {
  changeStage,
  deriveUnits,
  destroyUnit,
  measureUnit,
  moveUnit,
} from "@/features/unit/service";
import { runReport, reportToCsv } from "@/lib/reports";
import { getActiveStatesAtDate, getUnitStateAtDate } from "@/lib/reports/state-at-date";
import { zonedDateKey } from "@/lib/lab-time";
import { ADDITION_LINES } from "@/lib/reports/ctls-template";
import { prisma } from "@/server/db";
import type { CtlsFormClass, ReportResult } from "@/lib/reports/types";
import { createLab, registerOne, resetDatabase } from "./helpers";

// The lab is in Toronto: every period below is a Toronto calendar period.
process.env.LAB_TIMEZONE = "America/Toronto";

type Lab = Awaited<ReturnType<typeof createLab>>;
type MeasureInput = Parameters<typeof measureUnit>[2];
type StageInput = Parameters<typeof changeStage>[2];
type DestroyInput = Parameters<typeof destroyUnit>[2];
type DeriveInput = Parameters<typeof deriveUnits>[2];

const at = (iso: string) => new Date(iso);
const ADDITIONS: ReadonlySet<string> = new Set(ADDITION_LINES);

function ctlsClass(result: ReportResult, id: CtlsFormClass["id"]): CtlsFormClass {
  const found = result.ctls?.classes.find((c) => c.id === id);
  if (!found) throw new Error(`CTLS class ${id} missing`);
  return found;
}

/** The lines of a class that are not zero (opening and closing always included). */
function nonZero(result: ReportResult, id: CtlsFormClass["id"]) {
  return Object.fromEntries(
    Object.entries(ctlsClass(result, id).lines).filter(
      ([line, value]) => value !== 0 || line === "opening" || line === "closing"
    )
  );
}

function rows(result: ReportResult, sectionIndex = 0) {
  return result.sections[sectionIndex]?.rows ?? [];
}

function sectionRows(result: ReportResult, id: string) {
  return result.sections.find((section) => section.id === id)?.rows ?? [];
}

function kpi(result: ReportResult, label: string) {
  return result.kpis?.find((k) => k.label === label)?.value;
}

/** A whole, quantity-less shipment as imported data records it (the snapshot is what is left). */
async function ship(lab: Lab, unitId: number, effectiveAt: Date) {
  const { currentState: current } = await prisma.biologicalUnit.findUniqueOrThrow({
    where: { id: unitId },
    include: { currentState: true },
  });
  if (!current) throw new Error("unit has no state");
  const state = await prisma.unitState.create({
    data: {
      unitId,
      sequence: current.sequence + 1,
      kind: UnitStateKind.SHIPPED,
      effectiveAt,
      recordedById: lab.member.id,
      locationId: current.locationId,
      growthStage: current.growthStage,
      humidWeight: current.humidWeight,
      dryWeight: current.dryWeight,
      seedCount: current.seedCount,
      organizationId: lab.provider.id,
    },
  });
  await prisma.biologicalUnit.update({ where: { id: unitId }, data: { currentStateId: state.id } });
}

function destroy(lab: Lab, unitId: number, effectiveAt: string, reason = "Contaminated") {
  return destroyUnit(lab.admin, unitId, {
    reason,
    effectiveAt,
  } as DestroyInput);
}

describe("reports: March 2025 (spring-forward month, Toronto)", () => {
  let lab: Lab;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();

    const reg = async (name: string, effectiveAt: string, extra = {}) => {
      id[name] = (await registerOne(lab, { name, effectiveAt, ...extra })).id;
    };

    // Active before March.
    await reg("A", "2025-02-10T15:00:00Z");
    // 2025-03-01T04:30Z is 23:30 on 28 February in Toronto: February, not March.
    await reg("B", "2025-03-01T04:30:00Z");
    await reg("C", "2025-02-15T15:00:00Z");
    await reg("D", "2025-01-10T15:00:00Z");
    await destroy(lab, id.D!, "2025-02-20T15:00:00Z");
    await reg("CULT", "2025-02-01T15:00:00Z", { type: UnitType.CULTURE, growthStage: undefined });
    await reg("SEEDS", "2025-02-05T15:00:00Z", {
      type: UnitType.SEEDLOT,
      seedCount: 500,
      growthStage: undefined,
    });
    await reg("FLOW0", "2025-02-20T15:00:00Z", {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 50,
      dryWeight: 10,
    });

    // Reduction exactly at the first instant of March (midnight in Toronto): belongs to March.
    await destroy(lab, id.C!, "2025-03-01T05:00:00Z", "Mildew");

    // Registered during March.
    await reg("E", "2025-03-10T16:00:00Z");
    await changeStage(lab.member, id.E!, {
      toStage: GrowthStage.FLOWERING,
      effectiveAt: "2025-03-15T16:00:00Z",
    } as StageInput);
    // 2025-04-01T03:30Z is 23:30 on 31 March in Toronto: still March.
    await reg("F", "2025-04-01T03:30:00Z");
    // 2025-04-01T04:00Z is 00:00 on 1 April in Toronto: April.
    await reg("G", "2025-04-01T04:00:00Z");
    await reg("H", "2025-03-12T15:00:00Z");
    await destroy(lab, id.H!, "2025-03-20T15:00:00Z", "Spider mites");
    await reg("M", "2025-03-05T15:00:00Z");
    await destroy(lab, id.M!, "2025-04-01T03:59:00Z", "Root rot"); // 23:59 on 31 March
    await reg("N", "2025-03-05T15:00:00Z");
    await destroy(lab, id.N!, "2025-04-01T04:00:00Z", "Too late for March"); // 00:00 on 1 April

    // Daylight-saving day: 06:30Z is 01:30 EST, 03:30Z next day is 23:30 EDT on 9 March.
    await reg("P", "2025-03-09T06:30:00Z");
    await changeStage(lab.member, id.P!, {
      toStage: GrowthStage.FLOWERING,
      effectiveAt: "2025-03-09T07:30:00Z", // 03:30 EDT; 02:30 never existed
    } as StageInput);
    await destroy(lab, id.P!, "2025-03-10T03:30:00Z", "Heat stress");

    // Shipment, culture and seeds re-counted, flower harvested and re-weighed.
    await ship(lab, id.CULT!, at("2025-03-25T15:00:00Z"));
    await measureUnit(lab.member, id.SEEDS!, {
      seedCount: 450,
      effectiveAt: "2025-03-05T15:00:00Z",
    } as MeasureInput);
    await reg("FLOW1", "2025-03-03T15:00:00Z", {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 100,
      dryWeight: 20,
    });
    // Re-weighing a recorded weight is an administrator's correction, with a reason.
    await measureUnit(lab.admin, id.FLOW1!, {
      humidWeight: 90,
      dryWeight: 18,
      effectiveAt: "2025-03-18T15:00:00Z",
      comment: "Re-weighed after trimming",
    } as MeasureInput);
    await destroy(lab, id.FLOW0!, "2025-03-22T15:00:00Z", "Failed potency");

    // Not a stock movement: a voided DRAFT shipment that names unit A.
    const shipment = await prisma.shipment.create({
      data: {
        reference: "SHP-VOID",
        direction: "OUTBOUND",
        organizationId: lab.provider.id,
        userId: lab.admin.id,
        voidedAt: at("2025-03-12T15:00:00Z"),
        voidedById: lab.admin.id,
        voidReason: "Entered in error",
      },
    });
    await prisma.shipmentItem.create({
      data: {
        shipmentId: shipment.id,
        unitId: id.A!,
        description: "Voided",
        materialType: "PLANT",
        measure: "COUNT",
        unitCount: 1,
      },
    });
  });

  describe("CTLS monthly", () => {
    it("reconciles every class: closing = opening + additions - reductions", async () => {
      const march = await runReport("ctls-monthly", { year: 2025, month: 3 });
      expect(march.ctls?.reconciles).toBe(true);
      for (const cls of march.ctls?.classes ?? []) {
        const { opening = 0, closing = 0, ...flows } = cls.lines;
        let balance = opening;
        for (const [line, value] of Object.entries(flows)) {
          balance += ADDITIONS.has(line) ? (value ?? 0) : -(value ?? 0);
        }
        expect(balance, cls.id).toBeCloseTo(closing, 6);
        expect(cls.reconciles, cls.id).toBe(true);
      }
      expect(kpi(march, "Reconciled")).toBe("Yes");
    });

    it("counts vegetative and whole plants with Toronto month boundaries", async () => {
      const march = await runReport("ctls-monthly", { year: 2025, month: 3 });
      expect(march.meta.periodLabel).toBe("March 2025");
      // Opening: A, B (28 Feb 23:30 local), C. D left in February.
      // Registered (internal stock, "other"): E, F (31 Mar 23:30 local), H, M, N, P. G is April.
      // E and P started flowering: processed out of vegetative, produced into whole plants.
      // Destroyed: C (midnight 1 Mar), H, M (31 Mar 23:59 local) vegetative; P flowering.
      expect(nonZero(march, "vegetativePlants")).toEqual({
        opening: 3,
        additionsOther: 6,
        processed: 2,
        destroyed: 3,
        closing: 4, // A B F N
      });
      expect(nonZero(march, "wholePlants")).toEqual({
        opening: 0,
        produced: 2,
        destroyed: 1,
        closing: 1, // E
      });
    });

    it("keeps tissue cultures apart and reports a seed recount as an other reduction", async () => {
      const march = await runReport("ctls-monthly", { year: 2025, month: 3 });
      expect(march.ctls?.cultures).toEqual({ opening: 1, added: 0, removed: 1, closing: 0 });
      expect(nonZero(march, "seeds")).toEqual({ opening: 500, reductionsOther: 50, closing: 450 });
    });

    it("reports harvested flower with a dry weight as dried cannabis, in kilograms", async () => {
      const march = await runReport("ctls-monthly", { year: 2025, month: 3 });
      // FLOW0 (10 g dry) destroyed; FLOW1 (20 g dry) registered and re-weighed to 18 g.
      expect(nonZero(march, "driedCannabis")).toEqual({
        opening: 0.01,
        additionsOther: 0.02,
        dryingLoss: 0.002,
        destroyed: 0.01,
        closing: 0.018,
      });
      expect(nonZero(march, "freshCannabis")).toEqual({ opening: 0, closing: 0 });
    });

    it("shows how each event was reported, and lists destructions and additions", async () => {
      const march = await runReport("ctls-monthly", { year: 2025, month: 3 });
      const movements = sectionRows(march, "form-movements");
      expect(movements).toContainEqual(
        expect.objectContaining({
          unit: "E",
          class: "Vegetative cannabis plants",
          line: "Reductions - Processed",
          quantity: 1,
          measure: "#",
        })
      );
      expect(movements).toContainEqual(
        expect.objectContaining({
          unit: "FLOW1",
          class: "Dried cannabis",
          line: "Reductions - Adjustment for drying / processing loss",
          quantity: 0.002,
          measure: "kg",
        })
      );
      const destructionNames = sectionRows(march, "destruction-detail").map((r) => r.unit);
      expect(destructionNames).toEqual(["C", "P", "H", "FLOW0", "M"]);
      const added = sectionRows(march, "additions-detail").map((r) => r.unit);
      expect(added).toEqual(expect.arrayContaining(["E", "F", "H", "M", "N", "P", "FLOW1"]));
      expect(added).not.toContain("G");
      expect(kpi(march, "Destructions")).toBe(5);
      expect(kpi(march, "Shipments")).toBe(1);
    });

    it("excludes other periods and the voided shipment", async () => {
      const february = await runReport("ctls-monthly", { year: 2025, month: 2 });
      // A, C and B (23:30 on 28 Feb) are registered in February; D is destroyed.
      expect(february.ctls?.reconciles).toBe(true);
      expect(nonZero(february, "vegetativePlants")).toEqual({
        opening: 1,
        additionsOther: 3,
        destroyed: 1,
        closing: 3,
      });
      const april = await runReport("ctls-monthly", { year: 2025, month: 4 });
      expect(april.ctls?.reconciles).toBe(true);
      // Opening = March's closing; G is added; N destroyed at 00:00 on 1 April.
      expect(nonZero(april, "vegetativePlants")).toEqual({
        opening: 4,
        additionsOther: 1,
        destroyed: 1,
        closing: 4,
      });
      expect(nonZero(april, "wholePlants")).toEqual({ opening: 1, closing: 1 });
      expect(sectionRows(april, "additions-detail").map((r) => r.unit)).toEqual(["G"]);
      expect(sectionRows(april, "destruction-detail").map((r) => r.unit)).toEqual(["N"]);
      expect(kpi(april, "Shipments")).toBe(0);
    });

    it("exports the worksheet CSV with the form's lines down and classes across", async () => {
      const march = await runReport("ctls-monthly", { year: 2025, month: 3 });
      const csv = reportToCsv(march);
      expect(csv).toContain(
        "Line,Seeds (#),Vegetative cannabis plants (#),Whole cannabis plants (#),Fresh cannabis (kg),Dried cannabis (kg)"
      );
      expect(csv).toContain("Opening inventory,500,3,0,0,0.01");
      expect(csv).toContain("Closing inventory,450,4,1,0,0.018");
    });
  });

  describe("state at a date", () => {
    it("returns null before the unit existed and the CREATED state at its first instant", async () => {
      expect(await getUnitStateAtDate(id.E!, at("2025-03-10T15:59:59.999Z"))).toBeNull();
      const created = await getUnitStateAtDate(id.E!, at("2025-03-10T16:00:00Z"));
      expect(created).toMatchObject({ kind: "CREATED", growthStage: "VEGETATIVE", active: true });
    });

    it("applies a back-dated stage change from its effective instant, not when it was filed", async () => {
      const before = await getUnitStateAtDate(id.E!, at("2025-03-15T15:59:59.999Z"));
      const on = await getUnitStateAtDate(id.E!, at("2025-03-15T16:00:00Z"));
      expect(before).toMatchObject({ kind: "CREATED", growthStage: "VEGETATIVE" });
      expect(on).toMatchObject({ kind: "STAGE_CHANGED", growthStage: "FLOWERING" });
    });

    it("places the month boundary at midnight in Toronto", async () => {
      // B was registered at 04:30Z on 1 March = 23:30 on 28 February.
      const lastInstantOfFebruary = at("2025-03-01T04:59:59.999Z");
      const firstInstantOfMarch = at("2025-03-01T05:00:00Z");
      expect(await getUnitStateAtDate(id.B!, lastInstantOfFebruary)).toMatchObject({
        active: true,
      });
      // C was destroyed exactly at the first instant of March.
      expect(await getUnitStateAtDate(id.C!, lastInstantOfFebruary)).toMatchObject({
        kind: "CREATED",
        active: true,
      });
      expect(await getUnitStateAtDate(id.C!, firstInstantOfMarch)).toMatchObject({
        kind: "DESTROYED",
        active: false,
      });
      const activeNames = (asOf: Date) =>
        getActiveStatesAtDate(asOf).then((s) => s.map((x) => x.unitName).sort());
      expect(await activeNames(lastInstantOfFebruary)).toEqual(
        ["A", "B", "C", "CULT", "FLOW0", "SEEDS"].sort()
      );
      expect(await activeNames(firstInstantOfMarch)).toEqual(
        ["A", "B", "CULT", "FLOW0", "SEEDS"].sort()
      );
    });

    it("handles the spring-forward gap (02:00-03:00 on 9 March does not exist)", async () => {
      const beforeGap = at("2025-03-09T06:59:59.999Z"); // 01:59:59.999 EST
      expect(await getUnitStateAtDate(id.P!, beforeGap)).toMatchObject({
        kind: "CREATED",
        growthStage: "VEGETATIVE",
      });
      expect(await getUnitStateAtDate(id.P!, at("2025-03-09T07:30:00Z"))).toMatchObject({
        kind: "STAGE_CHANGED",
        growthStage: "FLOWERING",
      });
      const wholeDay = await getUnitStateAtDate(id.P!, at("2025-03-10T03:29:59.999Z"));
      expect(wholeDay).toMatchObject({ active: true });
      expect(await getUnitStateAtDate(id.P!, at("2025-03-10T03:30:00Z"))).toMatchObject({
        kind: "DESTROYED",
        active: false,
      });
    });

    it("keeps a destroyed unit out of the active set and carries its weights back in time", async () => {
      expect(await getUnitStateAtDate(id.FLOW1!, at("2025-03-18T14:59:59.999Z"))).toMatchObject({
        humidWeight: 100,
        dryWeight: 20,
      });
      expect(await getUnitStateAtDate(id.FLOW1!, at("2025-03-18T15:00:00Z"))).toMatchObject({
        kind: "MEASURED",
        humidWeight: 90,
        dryWeight: 18,
      });
      const active = await getActiveStatesAtDate(at("2025-03-31T12:00:00Z"));
      const names = active.map((s) => s.unitName);
      expect(names).not.toContain("D");
      expect(names).not.toContain("FLOW0");
      expect(names).toContain("FLOW1");
      const seeds = active.find((s) => s.unitName === "SEEDS");
      expect(seeds?.seedCount).toBe(450);
    });

    it("lets a terminal event win even if a later-dated event was filed before it", async () => {
      // Late-filed back-dated destruction: unit Z is measured on 10 April, then destroyed with an
      // effective date of 5 April. The unit has left inventory from 5 April; the 10 April
      // measurement must not bring it back.
      const z = await registerOne(lab, {
        name: "Z",
        type: UnitType.FLOWER,
        growthStage: GrowthStage.HARVESTED,
        humidWeight: 10,
        effectiveAt: "2025-04-02T15:00:00Z",
      });
      await measureUnit(lab.admin, z.id, {
        humidWeight: 9,
        effectiveAt: "2025-04-10T15:00:00Z",
        comment: "Correction",
      } as MeasureInput);
      await destroy(lab, z.id, "2025-04-05T15:00:00Z");
      expect(await getUnitStateAtDate(z.id, at("2025-04-04T15:00:00Z"))).toMatchObject({
        active: true,
      });
      expect(await getUnitStateAtDate(z.id, at("2025-04-12T15:00:00Z"))).toMatchObject({
        kind: "DESTROYED",
        active: false,
      });
      // April reconciles with Z added and removed within the month.
      const april = await runReport("ctls-monthly", { year: 2025, month: 4 });
      expect(april.ctls?.reconciles).toBe(true);
    });
  });

  describe("destruction register", () => {
    it("lists a Toronto day's destructions by local date (not UTC date)", async () => {
      // P was destroyed 2025-03-10T03:30Z = 23:30 on 9 March in Toronto.
      const ninth = await runReport("destruction-register", {
        from: "2025-03-09",
        to: "2025-03-09",
      });
      expect(rows(ninth).map((r) => r.unit)).toEqual(["P"]);
      const tenth = await runReport("destruction-register", {
        from: "2025-03-10",
        to: "2025-03-10",
      });
      expect(rows(tenth)).toEqual([]);
    });

    it("includes the whole of the 'to' day through 23:59 local, and excludes the next day", async () => {
      const march = await runReport("destruction-register", {
        from: "2025-03-01",
        to: "2025-03-31",
      });
      // Newest first. M was destroyed at 23:59 on 31 March; N at 00:00 on 1 April is excluded;
      // D (February) is excluded.
      expect(rows(march).map((r) => r.unit)).toEqual(["M", "FLOW0", "H", "P", "C"]);
      expect(march.meta.periodLabel).toBe("2025-03-01 – 2025-03-31");
    });

    it("records unit, experiment, cultivar, date, reason, recorder and filing time", async () => {
      const result = await runReport("destruction-register", {
        from: "2025-03-20",
        to: "2025-03-20",
      });
      const [row] = rows(result);
      expect(rows(result)).toHaveLength(1);
      expect(row).toMatchObject({
        date: "2025-03-20 11:00", // 15:00Z is 11:00 EDT
        unit: "H",
        type: "PLANT",
        cultivar: "Northern Lights",
        experiment: "AB1",
        location: "Room 1",
        stage: "VEGETATIVE",
        reason: "Spider mites",
        recordedBy: "Admin",
      });
      // Filed now, not on the destruction date.
      expect(String(row?.filedAt)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(String(row?.filedAt) > "2025-03-20 11:00").toBe(true);
      expect(kpi(result, "Total destructions")).toBe(1);
      expect(kpi(result, "Plants destroyed")).toBe(1);
    });

    it("reports a flower's last weight", async () => {
      const result = await runReport("destruction-register", {
        from: "2025-03-22",
        to: "2025-03-22",
      });
      expect(rows(result)[0]).toMatchObject({ unit: "FLOW0", type: "FLOWER", weight: "10.00" });
    });

    it("is not affected by unbounded filters", async () => {
      const all = await runReport("destruction-register", {});
      expect(all.meta.periodLabel).toBe("All time");
      expect(rows(all).map((r) => r.unit)).toEqual(
        expect.arrayContaining(["D", "C", "H", "M", "N", "P", "FLOW0"])
      );
    });
  });
});

describe("reports: fall-back month (November 2025, Toronto)", () => {
  let lab: Lab;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    const reg = async (name: string, effectiveAt: string) => {
      id[name] = (await registerOne(lab, { name, effectiveAt })).id;
    };
    await reg("Q", "2025-10-20T15:00:00Z");
    await reg("T", "2025-10-25T15:00:00Z");
    // 04:59Z on 1 Dec is 23:59 on 30 Nov (EST): November. 05:00Z is 00:00 on 1 Dec: December.
    await reg("R", "2025-12-01T04:59:00Z");
    await reg("S", "2025-12-01T05:00:00Z");
    // 05:30Z on 2 Nov is the first 01:30 (EDT), before the clocks go back at 06:00Z.
    await reg("U", "2025-11-02T05:30:00Z");
    // 06:30Z on 2 Nov is the second 01:30 (EST).
    await destroy(lab, id.Q!, "2025-11-02T06:30:00Z", "Fungus");
  });

  it("uses the 25-hour fall-back day and the local month edges", async () => {
    const november = await runReport("ctls-monthly", { year: 2025, month: 11 });
    expect(november.meta.periodLabel).toBe("November 2025");
    // Opening Q, T; additions R, U; reduction Q; closing T, R, U. S is December.
    expect(nonZero(november, "vegetativePlants")).toEqual({
      opening: 2,
      additionsOther: 2,
      destroyed: 1,
      closing: 3,
    });
    expect(november.ctls?.reconciles).toBe(true);
    const december = await runReport("ctls-monthly", { year: 2025, month: 12 });
    expect(nonZero(december, "vegetativePlants")).toEqual({
      opening: 3,
      additionsOther: 1,
      closing: 4,
    });
    expect(december.ctls?.reconciles).toBe(true);
  });

  it("distinguishes the two 01:30s on the fall-back night", async () => {
    expect(await getUnitStateAtDate(id.Q!, at("2025-11-02T06:29:59.999Z"))).toMatchObject({
      active: true,
    });
    expect(await getUnitStateAtDate(id.Q!, at("2025-11-02T06:30:00Z"))).toMatchObject({
      kind: "DESTROYED",
      active: false,
    });
    const day = await runReport("destruction-register", { from: "2025-11-02", to: "2025-11-02" });
    expect(rows(day).map((r) => r.unit)).toEqual(["Q"]);
    expect(rows(day)[0]?.date).toBe("2025-11-02 01:30");
  });
});

describe("reports: operations on today's data", () => {
  let lab: Lab;
  const id: Record<string, number> = {};
  const today = zonedDateKey(new Date(), "America/Toronto");
  const from = "2020-01-01";

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();

    id.MOM = (await registerOne(lab, { name: "MOM" })).id;
    const derived = await deriveUnits(lab.member, id.MOM, {
      deriveType: "clone",
      quantity: 2,
    } as DeriveInput);
    id.CL1 = derived.units[0]!.id;
    id.CL2 = derived.units[1]!.id;
    id.SEEDS = (
      await registerOne(lab, {
        name: "SEEDS",
        type: UnitType.SEEDLOT,
        seedCount: 100,
        growthStage: undefined,
        sourceType: SourceType.RECEIVED,
        providerOrganizationId: lab.provider.id,
        sourceDescription: undefined,
      })
    ).id;

    await moveUnit(
      lab.member,
      id.CL1,
      { toLocationId: lab.rooms[1].id, barcode: "MOM-CL-1" },
      { requireScan: false }
    );
    await moveUnit(lab.member, id.CL2, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await changeStage(lab.member, id.MOM, { toStage: GrowthStage.FLOWERING } as StageInput);
    await destroy(lab, id.CL2, today, "Hermaphrodite");
  });

  it("inventory snapshot groups active units by type, stage, location and cultivar", async () => {
    const result = await runReport("inventory-snapshot", {});
    expect(kpi(result, "Active units")).toBe(3); // MOM, CL-1, SEEDS; CL-2 destroyed
    const section = (title: string) => result.sections.find((s) => s.title === title)?.rows ?? [];
    expect(section("Summary by material type")).toEqual([
      { type: "PLANT", count: 2, wet: 0, dry: 0, seeds: 0 },
      { type: "SEEDLOT", count: 1, wet: 0, dry: 0, seeds: 100 },
    ]);
    expect(section("Summary by growth stage").map((r) => [r.stage, r.count])).toEqual([
      ["FLOWERING", 1],
      ["No stage", 1],
      ["VEGETATIVE", 1],
    ]);
    expect(section("Summary by location").map((r) => [r.location, r.count])).toEqual([
      ["Room 1", 2],
      ["Room 2", 1],
    ]);
    expect(section("Summary by cultivar").map((r) => [r.cultivar, r.count])).toEqual([
      ["Northern Lights", 3],
    ]);
    expect(section("Unit detail").map((r) => r.name)).toEqual(["MOM", "MOM-CL-1", "SEEDS"]);
  });

  it("inventory snapshot honours the type and location filters", async () => {
    const plants = await runReport("inventory-snapshot", { unitType: "PLANT" });
    expect(kpi(plants, "Active units")).toBe(2);
    const room2 = await runReport("inventory-snapshot", { locationId: lab.rooms[1].id });
    expect(kpi(room2, "Active units")).toBe(1);
  });

  it("inventory movement lists every event kind with direction", async () => {
    const result = await runReport("inventory-movement", { from, to: today });
    const byAction = Object.fromEntries(
      (result.sections.find((s) => s.title === "Summary by event")?.rows ?? []).map((r) => [
        r.action,
        r.count,
      ])
    );
    expect(byAction).toEqual({
      Registered: 1,
      Derived: 2,
      Received: 1,
      Moved: 2,
      "Stage transition": 1,
      Destroyed: 1,
    });
    expect(kpi(result, "Additions")).toBe(4);
    expect(kpi(result, "Reductions")).toBe(1);
    const destroyed = rows(result).find((r) => r.action === "Destroyed");
    expect(destroyed?.detail).toBe("Hermaphrodite");
    const received = rows(result).find((r) => r.action === "Received");
    expect(received?.detail).toBe("From Seed Supplier Inc.");
  });

  it("transfer log shows from/to, scan confirmation and operator", async () => {
    const result = await runReport("transfer-log", { from, to: today });
    const byUnit = Object.fromEntries(rows(result).map((r) => [r.unit, r]));
    expect(byUnit["MOM-CL-1"]).toMatchObject({
      from: "Room 1",
      to: "Room 2",
      confirmed: "Yes",
      operator: "Member",
    });
    expect(byUnit["MOM-CL-2"]).toMatchObject({ from: "Room 1", to: "Room 2", confirmed: "No" });
    expect(kpi(result, "Barcode confirmed")).toBe(1);
    const room3 = await runReport("transfer-log", { from, to: today, locationId: lab.rooms[2].id });
    expect(rows(room3)).toEqual([]);
  });

  it("stage history shows the previous and new stage", async () => {
    const result = await runReport("stage-history", { from, to: today });
    expect(rows(result)).toHaveLength(1);
    expect(rows(result)[0]).toMatchObject({
      unit: "MOM",
      from: "VEGETATIVE",
      to: "FLOWERING",
      operator: "Member",
    });
    expect(kpi(result, "To flowering")).toBe(1);
    const seedOnly = await runReport("stage-history", { from, to: today, unitType: "SEEDLOT" });
    expect(rows(seedOnly)).toEqual([]);
  });

  it("experiment summary separates active and destroyed units", async () => {
    const result = await runReport("experiment-summary", {});
    expect(rows(result)).toHaveLength(1);
    expect(rows(result)[0]).toMatchObject({
      ecode: "AB1",
      totalUnits: 4,
      active: 3,
      destroyed: 1,
      plants: 2,
      seedLots: 1,
      team: "Member (lead)",
    });
  });

  it("activity audit reads the audit log with lab-zone times and field changes", async () => {
    const result = await runReport("activity-audit", { from, to: today, entityType: "unit" });
    const expected = await prisma.auditLog.count({ where: { entityType: "unit" } });
    expect(rows(result)).toHaveLength(expected);
    const stage = rows(result).find((r) => String(r.summary).startsWith("Stage:"));
    expect(stage?.changes).toBe("stage: VEGETATIVE → FLOWERING");
    expect(String(rows(result)[0]?.date)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("the current month's CTLS reconciles and reports clones as produced", async () => {
    const result = await runReport("ctls-monthly", {});
    expect(result.ctls?.reconciles).toBe(true);
    // MOM registered from internal stock; two clones produced from it (deriving never consumes
    // the parent); MOM started flowering; CL-2 destroyed.
    expect(nonZero(result, "vegetativePlants")).toEqual({
      opening: 0,
      produced: 2,
      additionsOther: 1,
      processed: 1,
      destroyed: 1,
      closing: 1,
    });
    expect(nonZero(result, "wholePlants")).toEqual({ opening: 0, produced: 1, closing: 1 });
    // The seed lot came from a supplier with no country on record: domestic, and flagged.
    expect(nonZero(result, "seeds")).toEqual({ opening: 0, receivedDomestic: 100, closing: 100 });
    expect(result.ctls?.issues.countryMissing).toEqual(["Seed Supplier Inc."]);
    expect(kpi(result, "Derivations")).toBe(2);
    expect(kpi(result, "External receipts")).toBe(1);
  });
});
