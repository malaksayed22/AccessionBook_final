import { beforeEach, describe, expect, it } from "vitest";
import {
  HoldKind,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
} from "@/generated/prisma/enums";
import {
  getExperimentDetail,
  getExperimentLabels,
  getExperimentWizardOptions,
  listExperimentUnits,
  listExperiments,
  type ExperimentListParams,
  type ExperimentUnitParams,
} from "@/features/experiment/queries";
import { createExperiment } from "@/features/experiment/service";
import { placeHold } from "@/features/qa/service";
import { createShipment } from "@/features/shipment/service";
import { changeStage, destroyUnit } from "@/features/unit/service";
import { prisma } from "@/server/db";
import { createLab, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const base: ExperimentListParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const unitBase: ExperimentUnitParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe("experiment list and detail queries", () => {
  let lab: Lab;
  let ids: Record<string, number>;

  const day = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    // The fixture experiment AB1 ("Test experiment", no end date, led by the member) is "running".
    await prisma.experiment.update({
      where: { id: lab.experiment.id },
      data: { comment: "Baseline protocol" },
    });
    ids = { AB1: lab.experiment.id };

    const make = async (name: string, over: Record<string, unknown> = {}) => {
      const result = await createExperiment(lab.member, {
        name,
        startDate: day(-30),
        providerMode: "INTERNAL",
        ...over,
      } as never);
      ids[result.ecode] = result.id;
      return result;
    };

    // Running, with three units in Room 1.
    await make("Bravo trial", {
      locationId: lab.rooms[0].id,
      providerMode: "INTERNAL",
      sourceDescription: "Internal stock for the trial",
      unitGroups: [
        {
          kind: "CLONES",
          cultivarId: lab.cultivar.id,
          quantity: 3,
          statusMode: "SAME",
          status: "VEGETATIVE",
        },
      ],
    });
    // Completed (finished last month), no units.
    const alpha = await make("Alpha study", { startDate: day(-90) });
    await prisma.experiment.update({
      where: { id: alpha.id },
      data: { endDate: new Date(`${day(-30)}T00:00:00Z`) },
    });
    // Running, external supply with a receipt, 2 units in Room 2; holds and a destruction below.
    await make("Charlie run", {
      comment: "Photoperiod 100%_test",
      locationId: lab.rooms[1].id,
      providerMode: "EXTERNAL",
      providerOrganizationId: lab.provider.id,
      unitGroups: [
        {
          kind: "SEEDS",
          cultivarId: lab.cultivar.id,
          quantity: 2,
          statusMode: "SAME",
        },
      ],
    });
  });

  describe("listExperiments", () => {
    it("lists every experiment with its status, team and unit counts", async () => {
      const { rows, total } = await listExperiments(lab.admin, base);
      expect(total).toBe(4);
      expect(Object.fromEntries(rows.map((r) => [r.name, r.status]))).toEqual({
        "Alpha study": "completed",
        "Bravo trial": "active",
        "Charlie run": "active",
        "Test experiment": "active",
      });
      const bravo = rows.find((r) => r.name === "Bravo trial")!;
      expect(bravo.unitCount).toBe(3);
      expect(bravo.members).toEqual([{ userId: lab.member.id, name: "Member", role: "LEAD" }]);
      expect(bravo.stats).toMatchObject({
        inventory: 3,
        active: 3,
        onHold: 0,
        nothingLeft: 0,
        destroyed: 0,
        types: [{ type: "PLANT", count: 3 }],
        locations: [{ name: "Room 1", count: 3 }],
      });
      expect(rows.find((r) => r.name === "Alpha study")!.stats.inventory).toBe(0);
    });

    it("shows when each lifecycle stage started and ended, and how many days it took", async () => {
      const bravo = await prisma.biologicalUnit.findMany({
        where: { experimentId: ids.EXP1 },
        orderBy: { name: "asc" },
      });
      // Two of the three plants move on to flowering 20 days ago; the third stays vegetative.
      const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
      for (const unit of bravo.slice(0, 2)) {
        await changeStage(lab.member, unit.id, {
          toStage: "FLOWERING",
          effectiveAt: daysAgo(20),
        });
      }
      const { rows } = await listExperiments(lab.admin, { ...base, q: "bravo" });
      const timeline = rows[0]!.stats.timeline;
      expect(timeline.map((s) => s.stage)).toEqual(["VEGETATIVE", "FLOWERING"]);
      const [vegetative, flowering] = timeline;
      // One plant is still vegetative, so that stage has no end; flowering began 20 days ago.
      expect(vegetative!.ended).toBeNull();
      expect(flowering!.ended).toBeNull();
      expect(flowering!.days).toBeGreaterThanOrEqual(20);
      expect(flowering!.days).toBeLessThanOrEqual(21);
      expect(vegetative!.started.getTime()).toBeLessThan(flowering!.started.getTime());

      // An experiment with no staged units has no timeline.
      expect(rows.length).toBe(1);
      const alpha = (await listExperiments(lab.admin, { ...base, q: "alpha" })).rows[0]!;
      expect(alpha.stats.timeline).toEqual([]);
    });

    it("ends a stage when its last unit leaves it", async () => {
      const units = await prisma.biologicalUnit.findMany({
        where: { experimentId: ids.EXP1 },
        orderBy: { name: "asc" },
      });
      const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
      for (const unit of units) {
        await changeStage(lab.member, unit.id, { toStage: "FLOWERING", effectiveAt: daysAgo(10) });
      }
      const detail = (await getExperimentDetail(lab.admin, ids.EXP1!))!;
      const vegetative = detail.timeline.find((s) => s.stage === "VEGETATIVE")!;
      expect(vegetative.ended).not.toBeNull();
      expect(vegetative.ended!.getTime()).toBeCloseTo(Date.now() - 10 * 86_400_000, -4);
      expect(detail.timeline.find((s) => s.stage === "FLOWERING")!.ended).toBeNull();
    });

    it("filters by status in the database", async () => {
      expect(
        names((await listExperiments(lab.admin, { ...base, status: "completed" })).rows)
      ).toEqual(["Alpha study"]);
      const running = await listExperiments(lab.admin, { ...base, status: "running" });
      expect(running.total).toBe(3);
      expect(names(running.rows)).not.toContain("Alpha study");
    });

    it("shows an administrator every experiment and a member only their own", async () => {
      const admin = await listExperiments(lab.admin, base);
      expect(admin.total).toBe(4);
      // The administrator belongs to none of them: "mine" narrows the administrator's list to nothing.
      expect((await listExperiments(lab.admin, { ...base, mine: true })).total).toBe(0);

      const member = await listExperiments(lab.member, base);
      expect(member.total).toBe(4);
      expect(member.rows.every((r) => r.mine)).toBe(true);

      // Someone in no experiment sees none, even though the experiments exist.
      expect((await listExperiments(lab.outsider, base)).total).toBe(0);
      await prisma.experimentMember.create({
        data: { experimentId: ids.EXP2!, userId: lab.outsider.id },
      });
      expect(names((await listExperiments(lab.outsider, base)).rows)).toEqual(["Alpha study"]);
    });

    it("never searches into experiments a member does not belong to", async () => {
      expect((await listExperiments(lab.outsider, { ...base, q: "bravo" })).total).toBe(0);
      expect((await listExperiments(lab.admin, { ...base, q: "bravo" })).total).toBe(1);
    });

    it("searches name, code, notes and team member, ignoring case", async () => {
      expect(names((await listExperiments(lab.admin, { ...base, q: "bravo" })).rows)).toEqual([
        "Bravo trial",
      ]);
      expect(names((await listExperiments(lab.admin, { ...base, q: "exp3" })).rows)).toEqual([
        "Charlie run",
      ]);
      expect(names((await listExperiments(lab.admin, { ...base, q: "BASELINE" })).rows)).toEqual([
        "Test experiment",
      ]);
      expect((await listExperiments(lab.admin, { ...base, q: "member" })).total).toBe(4);
      expect((await listExperiments(lab.admin, { ...base, q: "nothing like this" })).total).toBe(0);
    });

    it("treats search text as text, not as a pattern", async () => {
      expect((await listExperiments(lab.admin, { ...base, q: "%" })).total).toBe(1);
      expect((await listExperiments(lab.admin, { ...base, q: "100%_t" })).total).toBe(1);
      expect((await listExperiments(lab.admin, { ...base, q: "_" })).total).toBe(1);
      expect(
        (await listExperiments(lab.admin, { ...base, q: '\'; DROP TABLE "Experiment"; --' })).total
      ).toBe(0);
      expect((await listExperiments(lab.admin, base)).total).toBe(4);
    });

    it("sorts by name, code, units and dates, both ways", async () => {
      const sorted = async (p: Partial<ExperimentListParams>) =>
        names((await listExperiments(lab.admin, { ...base, ...p })).rows);
      expect(await sorted({ sort: "name", order: "desc" })).toEqual([
        "Test experiment",
        "Charlie run",
        "Bravo trial",
        "Alpha study",
      ]);
      expect(await sorted({ sort: "code" })).toEqual([
        "Test experiment", // AB1
        "Bravo trial", // EXP1
        "Alpha study", // EXP2
        "Charlie run", // EXP3
      ]);
      const byUnits = await sorted({ sort: "units", order: "desc" });
      expect(byUnits.slice(0, 2)).toEqual(["Bravo trial", "Charlie run"]);
      expect((await sorted({ sort: "units", order: "asc" })).slice(-1)).toEqual(["Bravo trial"]);
      // Oldest start first: the fixture experiment started on 2026-01-01, before everything else.
      expect((await sorted({ sort: "date", order: "asc" }))[0]).toBe("Test experiment");
      expect((await sorted({ sort: "date", order: "desc" }))[0]).toBe("Charlie run"); // ties break by id
      // By completion date: experiments that are still running (no date) go last either way.
      expect((await sorted({ sort: "end", order: "asc" }))[0]).toBe("Alpha study");
      expect((await sorted({ sort: "end", order: "desc" }))[0]).toBe("Alpha study");
    });

    it("pages without repeating or skipping rows", async () => {
      const first = await listExperiments(lab.admin, { ...base, limit: 3 });
      const second = await listExperiments(lab.admin, { ...base, limit: 3, page: 2 });
      expect(first.total).toBe(4);
      expect([...names(first.rows), ...names(second.rows)]).toEqual([
        "Alpha study",
        "Bravo trial",
        "Charlie run",
        "Test experiment",
      ]);
      expect((await listExperiments(lab.admin, { ...base, limit: 3, page: 9 })).rows).toEqual([]);
    });

    it("counts held and destroyed units on the card statistics", async () => {
      const bravoUnits = await prisma.biologicalUnit.findMany({
        where: { experimentId: ids.EXP1 },
        orderBy: { name: "asc" },
      });
      await placeHold(lab.member, bravoUnits[0]!.id, {
        reason: "Suspected mould",
        kind: HoldKind.HOLD,
      });
      await destroyUnit(lab.admin, bravoUnits[1]!.id, {
        reason: "Failed germination test, destroyed per SOP",
      });
      await createShipment(lab.admin, {
        direction: ShipmentDirection.OUTBOUND,
        organizationId: lab.provider.id,
        status: ShipmentStatus.IN_TRANSIT,
        items: [
          {
            unitId: bravoUnits[2]!.id,
            description: "Whole plant",
            materialType: MaterialClass.PLANT,
            unitCount: 1,
          },
        ],
      } as Parameters<typeof createShipment>[1]);

      // One status per unit, as the units list counts them: a held unit is not also active, and a
      // unit that shipped whole has nothing left.
      const counts = { inventory: 2, active: 0, onHold: 1, nothingLeft: 1, destroyed: 1 };
      const bravo = (await listExperiments(lab.admin, { ...base, q: "bravo" })).rows[0]!;
      expect(bravo.stats).toMatchObject(counts);
      expect(bravo.unitCount).toBe(3);
      expect((await getExperimentDetail(lab.admin, ids.EXP1!))!.counts).toEqual({
        total: 3,
        ...counts,
      });
      const filtered = async (status: "active" | "hold" | "empty" | "destroyed") =>
        names((await listExperimentUnits(lab.admin, ids.EXP1!, { ...unitBase, status })).rows);
      expect(await filtered("active")).toEqual([]);
      expect(await filtered("hold")).toEqual([bravoUnits[0]!.name]);
      expect(await filtered("empty")).toEqual([bravoUnits[2]!.name]);
      expect(await filtered("destroyed")).toEqual([bravoUnits[1]!.name]);
    });
  });

  describe("getExperimentDetail", () => {
    it("returns null for an experiment that does not exist, or one a member does not belong to", async () => {
      expect(await getExperimentDetail(lab.admin, 999_999)).toBeNull();
      expect(await getExperimentDetail(lab.outsider, ids.EXP1!)).toBeNull();
      expect(await getExperimentDetail(lab.member, ids.EXP1!)).not.toBeNull();
    });

    it("carries the type bar, the stage timeline, the estimate and the documents", async () => {
      const detail = (await getExperimentDetail(lab.admin, ids.EXP1!))!;
      expect(detail.types).toEqual([{ type: "PLANT", count: 3 }]);
      expect(detail.timeline.map((s) => s.stage)).toEqual(["VEGETATIVE"]);
      expect(detail.estimatedEndDate).toBeNull();
      expect(detail.documents).toEqual([]);
    });

    it("describes the project record: team, units, groups, locations and source", async () => {
      const detail = (await getExperimentDetail(lab.admin, ids.EXP1!))!;
      expect(detail).toMatchObject({
        ecode: "EXP1",
        name: "Bravo trial",
        status: "active",
        counts: { total: 3, inventory: 3, active: 3, onHold: 0, nothingLeft: 0, destroyed: 0 },
        locations: [{ name: "Room 1", count: 3 }],
        members: [{ name: "Member", role: "LEAD" }],
      });
      expect(detail.groups).toEqual([
        {
          type: "PLANT",
          cultivarId: lab.cultivar.id,
          cultivarName: "Northern Lights",
          total: 3,
          inventory: 3,
        },
      ]);
      expect(detail.provenance).toEqual([
        {
          sourceType: "INTERNAL",
          provider: null,
          description: "Internal stock for the trial",
          units: 3,
        },
      ]);
      expect(detail.receipts).toEqual([]);
    });

    it("lists the inbound receipt and the supplier of externally supplied units", async () => {
      const detail = (await getExperimentDetail(lab.admin, ids.EXP3!))!;
      expect(detail.provenance[0]).toMatchObject({
        provider: { id: lab.provider.id, name: "Seed Supplier Inc." },
        units: 2,
      });
      expect(detail.receipts).toHaveLength(1);
      expect(detail.receipts[0]).toMatchObject({
        status: "DELIVERED",
        lines: 2,
        organization: { name: "Seed Supplier Inc." },
      });
    });

    it("links parent and sub-experiments", async () => {
      const child = await createExperiment(lab.member, {
        name: "Bravo follow-up",
        startDate: day(-1),
        providerMode: "INTERNAL",
        parentExperimentId: ids.EXP1,
      } as never);
      const parent = (await getExperimentDetail(lab.admin, ids.EXP1!))!;
      expect(parent.children).toEqual([
        { id: child.id, ecode: child.ecode, name: "Bravo follow-up", status: "active" },
      ]);
      const sub = (await getExperimentDetail(lab.admin, child.id))!;
      expect(sub.parent).toMatchObject({ id: ids.EXP1, ecode: "EXP1" });
    });

    it("offers edit and team management only to those allowed", async () => {
      const asMember = (await getExperimentDetail(lab.member, ids.EXP1!))!;
      expect(asMember).toMatchObject({
        canEdit: true,
        canManageMembers: false,
        canViewAudit: false,
      });
      expect(asMember.availableUsers).toEqual([]);
      expect(asMember.activity.recent).toEqual([]);

      const asAdmin = (await getExperimentDetail(lab.admin, ids.EXP1!))!;
      expect(asAdmin).toMatchObject({ canEdit: true, canManageMembers: true, canViewAudit: true });
      expect(asAdmin.availableUsers.map((u) => u.name)).toEqual(["Admin", "Outsider", "Witness"]);
      expect(asAdmin.activity.recent[0]?.summary).toContain("Created experiment EXP1");
    });

    it("summarises activity", async () => {
      const detail = (await getExperimentDetail(lab.admin, ids.EXP1!))!;
      expect(detail.activity.unitEvents).toBe(3);
      expect(detail.activity.lastUnitEventAt).toBeInstanceOf(Date);
      expect(detail.activity.openIncidents).toBe(0);
    });
  });

  describe("listExperimentUnits", () => {
    it("filters by status, sorts and pages in the database", async () => {
      const units = await prisma.biologicalUnit.findMany({
        where: { experimentId: ids.EXP1 },
        orderBy: { name: "asc" },
      });
      await placeHold(lab.member, units[0]!.id, { reason: "Suspected mould", kind: HoldKind.HOLD });
      await destroyUnit(lab.admin, units[2]!.id, {
        reason: "Failed germination test, destroyed per SOP",
      });

      const all = await listExperimentUnits(lab.admin, ids.EXP1!, unitBase);
      expect(all.total).toBe(3);
      expect(Object.fromEntries(all.rows.map((r) => [r.name, r.status]))).toEqual({
        "EXP1-001": "on-hold",
        "EXP1-002": "active",
        "EXP1-003": "destroyed",
      });
      expect(
        names(
          (await listExperimentUnits(lab.admin, ids.EXP1!, { ...unitBase, status: "hold" })).rows
        )
      ).toEqual(["EXP1-001"]);
      expect(
        names(
          (await listExperimentUnits(lab.admin, ids.EXP1!, { ...unitBase, status: "active" })).rows
        )
      ).toEqual(["EXP1-002"]);

      expect(
        names(
          (await listExperimentUnits(lab.admin, ids.EXP1!, { ...unitBase, order: "desc" })).rows
        )
      ).toEqual(["EXP1-003", "EXP1-002", "EXP1-001"]);
      const first = await listExperimentUnits(lab.admin, ids.EXP1!, { ...unitBase, limit: 2 });
      const second = await listExperimentUnits(lab.admin, ids.EXP1!, {
        ...unitBase,
        limit: 2,
        page: 2,
      });
      expect([...names(first.rows), ...names(second.rows)]).toEqual([
        "EXP1-001",
        "EXP1-002",
        "EXP1-003",
      ]);
      // Another experiment's units never leak in.
      expect(
        (await listExperimentUnits(lab.admin, ids.EXP1!, unitBase)).rows.some((r) =>
          r.name.startsWith("EXP3")
        )
      ).toBe(false);
    });
  });

  describe("getExperimentLabels", () => {
    it("lists only units still in inventory", async () => {
      const units = await prisma.biologicalUnit.findMany({
        where: { experimentId: ids.EXP1 },
        orderBy: { name: "asc" },
      });
      await destroyUnit(lab.admin, units[0]!.id, {
        reason: "Failed germination test, destroyed per SOP",
      });
      const data = (await getExperimentLabels(lab.member, ids.EXP1!))!;
      expect(data.units.map((u) => u.name)).toEqual(["EXP1-002", "EXP1-003"]);
      expect(data.omitted).toBe(0);
      expect(data.experiment.ecode).toBe("EXP1");
      expect(await getExperimentLabels(lab.member, 999_999)).toBeNull();
    });
  });

  describe("getExperimentWizardOptions", () => {
    it("offers pickers and only the experiments the member belongs to", async () => {
      const asMember = await getExperimentWizardOptions(lab.member);
      expect(asMember.user).toMatchObject({ id: lab.member.id, admin: false });
      expect(asMember.users).toEqual([]);
      expect(asMember.cultivars.map((c) => c.name)).toEqual(["Northern Lights"]);
      expect(asMember.parentOptions.length).toBe(4);
      expect(asMember.locations.find((l) => l.name === "Room 1")).toMatchObject({ occupancy: 3 });

      const asOutsider = await getExperimentWizardOptions(lab.outsider);
      expect(asOutsider.parentOptions).toEqual([]);

      const asAdmin = await getExperimentWizardOptions(lab.admin);
      expect(asAdmin.users.map((u) => u.name)).toEqual(["Member", "Outsider", "Witness"]);
    });

    it("validates the parent experiment and the source unit it is given", async () => {
      const ok = await getExperimentWizardOptions(lab.member, { parentId: ids.EXP1 });
      expect(ok.parent).toMatchObject({ id: ids.EXP1, ecode: "EXP1" });
      expect(ok.parentProblem).toBeNull();

      const forbidden = await getExperimentWizardOptions(lab.outsider, { parentId: ids.EXP1 });
      expect(forbidden).toMatchObject({ parent: null, parentProblem: "forbidden" });

      const missing = await getExperimentWizardOptions(lab.member, { parentId: 999_999 });
      expect(missing).toMatchObject({ parent: null, parentProblem: "missing" });

      const unit = await prisma.biologicalUnit.findFirstOrThrow({
        where: { experimentId: ids.EXP1 },
      });
      const fromUnit = await getExperimentWizardOptions(lab.member, { sourceUnitId: unit.id });
      expect(fromUnit.sourceUnit).toMatchObject({
        id: unit.id,
        locationName: "Room 1",
        providerMode: "INTERNAL",
        suggestedKind: "CLONES",
      });
      expect(
        (await getExperimentWizardOptions(lab.member, { sourceUnitId: 999_999 })).sourceUnit
      ).toBeNull();
    });
  });
});
