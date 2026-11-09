import { beforeEach, describe, expect, it } from "vitest";
import { HoldKind, IncidentSeverity, TestPanel } from "@/generated/prisma/enums";
import {
  getQaOverview,
  listIncidents,
  searchUnitOptions,
  type QaOverviewParams,
} from "@/features/qa/queries";
import {
  openIncident,
  placeHold,
  recordLabTest,
  releaseHold,
  updateIncident,
  voidIncident,
  voidLabTest,
} from "@/features/qa/service";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const base: QaOverviewParams = { view: "overview", order: "desc", page: 1, limit: 10 };
const unitNames = (rows: Array<{ unit: { name: string } }>) => rows.map((r) => r.unit.name);

describe("quality console", () => {
  let lab: Lab;
  let ids: Record<string, number>;
  let testIds: Record<string, number>;
  let incidentIds: Record<string, number>;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    ids = {};
    testIds = {};
    incidentIds = {};
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      ids[name] = (await registerOne(lab, { name })).id;
    }
    // Alpha: manual hold. Bravo: second manual hold. Charlie: manual hold. Delta: held by an incident.
    await placeHold(lab.member, ids.Alpha!, { reason: "Suspected mould", kind: HoldKind.HOLD });
    await placeHold(lab.member, ids.Bravo!, {
      reason: "Cross contamination",
      kind: HoldKind.HOLD,
    });
    await placeHold(lab.member, ids.Charlie!, {
      reason: "Awaiting inspection",
      kind: HoldKind.HOLD,
    });
    const potency = await recordLabTest(lab.member, ids.Charlie!, {
      panel: TestPanel.POTENCY,
      analyte: "THC",
      value: 31,
      uom: "%",
    });
    testIds.potency = potency.testId;
    const described = await recordLabTest(lab.member, ids.Delta!, {
      panel: TestPanel.MICROBIALS,
      analyte: "Yeast",
      comment: "Not detected",
      labName: "Outside Lab",
    });
    testIds.described = described.testId;
    await recordLabTest(lab.member, ids.Delta!, {
      panel: TestPanel.POTENCY,
      analyte: "CBD",
      value: 5,
    });
    incidentIds.critical = (
      await openIncident(lab.member, {
        title: "Fridge failure",
        description: "Cold room warmed overnight",
        severity: IncidentSeverity.CRITICAL,
        unitId: ids.Delta,
      })
    ).incidentId;
    incidentIds.minor = (
      await openIncident(lab.member, {
        title: "Label misprint",
        description: "Wrong date on a tag",
        severity: IncidentSeverity.MINOR,
      })
    ).incidentId;
  });

  it("counts holds, recorded results and open incidents", async () => {
    const { counts } = await getQaOverview(lab.admin, base);
    // Delta was held automatically by the critical incident.
    expect(counts).toEqual({
      holds: 4,
      tests: 3,
      openIncidents: 2,
      criticalIncidents: 1,
      majorIncidents: 0,
      minorIncidents: 1,
    });
  });

  it("lists every recorded result, but never a voided one", async () => {
    const { tests } = await getQaOverview(lab.admin, { ...base, view: "tests" });
    expect(tests.total).toBe(3);
    expect(tests.rows.map((t) => t.analyte).sort()).toEqual(["CBD", "THC", "Yeast"]);
    await voidLabTest(lab.admin, testIds.potency!, { reason: "Entered on the wrong unit" });
    const after = await getQaOverview(lab.admin, { ...base, view: "tests" });
    expect(after.tests.rows.map((t) => t.analyte).sort()).toEqual(["CBD", "Yeast"]);
    expect(after.counts.tests).toBe(2);
  });

  it("shows holds with reason, origin, age and location, and filters them by kind", async () => {
    const { holds } = await getQaOverview(lab.admin, {
      ...base,
      view: "holds",
      sort: "unit",
      order: "asc",
    });
    expect(unitNames(holds.rows)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    const alpha = holds.rows[0]!;
    expect(alpha).toMatchObject({
      kind: "HOLD",
      origin: "MANUAL",
      reason: "Suspected mould",
      placedBy: "Member",
      ageDays: 0,
      locationName: "Room 1",
    });
    expect(holds.rows[2]).toMatchObject({ origin: "MANUAL", reason: "Awaiting inspection" });
    expect(holds.rows[3]).toMatchObject({ origin: "AUTO_INCIDENT" });

    // Searching narrows the list, but the headline count stays the whole laboratory's.
    const found = await getQaOverview(lab.admin, { ...base, view: "holds", q: "cross" });
    expect(unitNames(found.holds.rows)).toEqual(["Bravo"]);
    expect(found.holds.total).toBe(1);
    expect(found.counts.holds).toBe(4);
  });

  it("drops a released hold from the console", async () => {
    await releaseHold(lab.admin, ids.Alpha!, { note: "Mould ruled out by lab" });
    const { holds, counts } = await getQaOverview(lab.admin, { ...base, view: "holds" });
    expect(unitNames(holds.rows)).not.toContain("Alpha");
    expect(counts.holds).toBe(3);
  });

  it("previews each list on the overview and pages its own view", async () => {
    for (let i = 0; i < 12; i += 1) {
      const id = (await registerOne(lab, { name: `Extra ${String(i).padStart(2, "0")}` })).id;
      await placeHold(lab.member, id, { reason: "Batch hold for testing", kind: HoldKind.HOLD });
    }
    const overview = await getQaOverview(lab.admin, base);
    expect(overview.holds.rows).toHaveLength(10);
    expect(overview.holds.total).toBe(16);

    const pageOne = await getQaOverview(lab.admin, {
      ...base,
      view: "holds",
      sort: "unit",
      order: "asc",
      limit: 10,
    });
    const pageTwo = await getQaOverview(lab.admin, {
      ...base,
      view: "holds",
      sort: "unit",
      order: "asc",
      limit: 10,
      page: 2,
    });
    const all = [...unitNames(pageOne.holds.rows), ...unitNames(pageTwo.holds.rows)];
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
    expect(all).toEqual([...all].sort());
    // Lists other than the open view are not loaded.
    expect(pageOne.tests.rows).toEqual([]);
  });

  it("sorts holds by age (longest first) and incidents by severity (most severe first)", async () => {
    const { holds } = await getQaOverview(lab.admin, {
      ...base,
      view: "holds",
      sort: "age",
      order: "desc",
    });
    const placed = holds.rows.map((h) => h.placedAt.getTime());
    expect(placed).toEqual([...placed].sort((a, b) => a - b));

    const { incidents } = await getQaOverview(lab.admin, {
      ...base,
      view: "incidents",
      sort: "severity",
      order: "desc",
    });
    expect(incidents.rows.map((i) => i.severity)).toEqual(["CRITICAL", "MINOR"]);
    const reversed = await getQaOverview(lab.admin, {
      ...base,
      view: "incidents",
      sort: "severity",
      order: "asc",
    });
    expect(reversed.incidents.rows.map((i) => i.severity)).toEqual(["MINOR", "CRITICAL"]);
  });

  it("searches unit names, reasons, analytes and incident titles, safely", async () => {
    const holds = (q: string) => getQaOverview(lab.admin, { ...base, view: "holds", q });
    expect(unitNames((await holds("mould")).holds.rows)).toEqual(["Alpha"]);
    expect(unitNames((await holds("BRAV")).holds.rows)).toEqual(["Bravo"]);
    expect((await holds("%")).holds.total).toBe(0);
    expect((await holds(`'; DROP TABLE "UnitHold"; --`)).holds.total).toBe(0);

    const tests = await getQaOverview(lab.admin, { ...base, view: "tests", q: "outside lab" });
    expect(tests.tests.rows.map((t) => t.analyte)).toEqual(["Yeast"]);
    const incidents = await getQaOverview(lab.admin, { ...base, view: "incidents", q: "fridge" });
    expect(incidents.incidents.rows.map((i) => i.title)).toEqual(["Fridge failure"]);
    // The unit an incident is linked to is searched too.
    const byUnit = await getQaOverview(lab.admin, { ...base, view: "incidents", q: "delta" });
    expect(byUnit.incidents.rows.map((i) => i.title)).toEqual(["Fridge failure"]);
  });

  it("filters incidents by severity", async () => {
    const minor = await getQaOverview(lab.admin, { ...base, view: "incidents", severity: "MINOR" });
    expect(minor.incidents.rows.map((i) => i.title)).toEqual(["Label misprint"]);
  });

  it("lists incidents until they are closed or voided", async () => {
    await updateIncident(lab.admin, incidentIds.minor!, {
      status: "CLOSED",
      resolution: "Reprinted the tags",
    });
    await voidIncident(lab.admin, incidentIds.critical!, { reason: "Duplicate entry" });
    const { incidents, counts } = await getQaOverview(lab.admin, { ...base, view: "incidents" });
    expect(incidents.rows).toEqual([]);
    expect(counts.openIncidents).toBe(0);
    // The full list still has the closed one, but not the voided one.
    const everything = await listIncidents(lab.admin, { limit: 50 });
    expect(everything.map((i) => i.title)).toEqual(["Label misprint"]);
  });

  it("offers units for holds only while they are in inventory and not held", async () => {
    const names = async (q: string, scope: "any" | "holdable") =>
      (await searchUnitOptions(lab.admin, q, scope)).map((u) => u.name);
    expect(await names("alpha", "holdable")).toEqual([]); // already held
    expect(await names("alpha", "any")).toEqual(["Alpha"]);
    await releaseHold(lab.admin, ids.Alpha!, { note: "Mould ruled out by lab" });
    expect(await names("alpha", "holdable")).toEqual(["Alpha"]);
    expect(await names("%", "any")).toEqual([]);
    expect(await names("", "any")).toEqual([]);
    const [alpha] = await searchUnitOptions(lab.admin, "alpha", "any");
    expect(alpha).toMatchObject({ type: "PLANT", standing: "active" });
  });
});
