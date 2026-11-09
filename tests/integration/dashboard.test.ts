import { beforeEach, describe, expect, it } from "vitest";
import { GrowthStage, HoldKind, SourceType, UnitType } from "@/generated/prisma/enums";
import { getDashboard } from "@/features/dashboard/queries";
import { placeHold } from "@/features/qa/service";
import { destroyUnit, registerUnits } from "@/features/unit/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

process.env.LAB_TIMEZONE = "America/Toronto";

type Lab = Awaited<ReturnType<typeof createLab>>;

const DAY = 86_400_000;

describe("dashboard", () => {
  let lab: Lab;
  const now = new Date();
  const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);
  const ids: Record<string, number> = {};

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();

    // Alpha: fine. Bravo: manual hold. Charlie: fails a potency test (auto-hold).
    // Delta: destroyed, so it is out of inventory. Seeds and Cult: other unit types.
    for (const [name, room] of [
      ["Alpha", 0],
      ["Bravo", 1],
      ["Charlie", 1],
      ["Delta", 2],
    ] as const) {
      ids[name] = (await registerOne(lab, { name, locationId: lab.rooms[room].id })).id;
    }
    ids.Seeds = (
      await registerOne(lab, {
        name: "Seeds",
        type: UnitType.SEEDLOT,
        seedCount: 100,
        growthStage: undefined,
        locationId: lab.rooms[0].id,
      })
    ).id;
    ids.Cult = (
      await registerOne(lab, {
        name: "Cult",
        type: UnitType.CULTURE,
        growthStage: undefined,
        locationId: lab.rooms[0].id,
      })
    ).id;
    await placeHold(lab.member, ids.Bravo!, { reason: "Suspected mould", kind: HoldKind.HOLD });
    await placeHold(lab.member, ids.Charlie!, {
      reason: "Awaiting inspection",
      kind: HoldKind.HOLD,
    });
    await destroyUnit(lab.admin, ids.Delta!, {
      reason: "Failed germination, destroyed per SOP",
    });
  });

  it("counts units on hold", async () => {
    const { onHold } = await getDashboard(lab.admin);
    expect(onHold).toBe(2); // Bravo and Charlie
  });

  it("lists the experiments still running, newest first, with their units in inventory", async () => {
    const member = (experimentId: number) =>
      prisma.experimentMember.create({ data: { experimentId, userId: lab.member.id } });
    const make = async (ecode: string, endDate: Date | null) => {
      const experiment = await prisma.experiment.create({
        data: { ecode, name: ecode, startDate: daysFromNow(-100), endDate },
      });
      await member(experiment.id);
      return experiment;
    };

    // Units are registered while an experiment runs; completing it sets its end date.
    const withStock = await make("DONE1", null);
    await registerOne(lab, { name: "Stock", experimentId: withStock.id });
    const empty = await make("DONE2", null);
    for (const experiment of [withStock, empty]) {
      await prisma.experiment.update({
        where: { id: experiment.id },
        data: { endDate: daysFromNow(-10) },
      });
    }
    await make("OPEN1", null);
    await make("OPEN2", null);

    const { runningExperiments, runningExperimentCount } = await getDashboard(lab.admin);
    // Running = not completed (no end date): AB1 (from the fixture), OPEN1 and OPEN2.
    // The two completed experiments (DONE1, DONE2) are not listed.
    expect(runningExperimentCount).toBe(3);
    expect(runningExperiments.map((e) => e.ecode).sort()).toEqual(["AB1", "OPEN1", "OPEN2"]);
    // AB1 holds Alpha, Bravo, Charlie, Seeds and Cult in inventory; Delta was destroyed.
    expect(runningExperiments.find((e) => e.ecode === "AB1")?.activeUnits).toBe(5);
  });

  it("groups inventory by type, stage and location, leaving destroyed units out", async () => {
    const { inventory } = await getDashboard(lab.admin);
    expect(inventory.total).toBe(5);
    expect(inventory.byType).toEqual([
      { key: "PLANT", count: 3 },
      { key: "SEEDLOT", count: 1 },
      { key: "CULTURE", count: 1 },
    ]);
    // Seed lots and cultures have a bucket of their own.
    expect(Object.fromEntries(inventory.byStage.map((s) => [s.key, s.count]))).toEqual({
      VEGETATIVE: 3,
      SEED: 1,
      CULTURE: 1,
    });
    // Room 1: Alpha, Seeds, Cult; Room 2: Bravo, Charlie; Room 3 held only Delta (destroyed).
    expect(inventory.byLocation).toEqual([
      { id: lab.rooms[0].id, name: "Room 1", count: 3, capacity: null },
      { id: lab.rooms[1].id, name: "Room 2", count: 2, capacity: null },
    ]);
    expect(inventory.otherLocations).toEqual({ locations: 0, units: 0 });
    expect(inventory.unlocated).toBe(0);
  });

  it("shows administrators the audit trail and members the latest unit events", async () => {
    const admin = await getDashboard(lab.admin);
    expect(admin.recent.kind).toBe("audit");
    if (admin.recent.kind === "audit") {
      expect(admin.recent.entries.length).toBeGreaterThan(0);
      const seqs = admin.recent.entries.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    }

    const member = await getDashboard(lab.member);
    expect(member.recent.kind).toBe("events");
    if (member.recent.kind === "events") {
      expect(member.recent.events.length).toBeGreaterThan(0);
      expect(member.recent.events.length).toBeLessThanOrEqual(8);
      expect(member.recent.events[0]).toMatchObject({ unitName: expect.any(String) });
    }
  });

  it("shows a member only the experiments they belong to, and an administrator everything", async () => {
    const other = await prisma.experiment.create({
      data: { ecode: "OTH1", name: "Someone else's", startDate: daysFromNow(-5) },
    });
    await registerUnits(lab.admin, {
      type: UnitType.PLANT,
      name: "Hidden",
      quantity: 2,
      experimentId: other.id,
      cultivarId: lab.cultivar.id,
      locationId: lab.rooms[2].id,
      sourceType: SourceType.INTERNAL,
      sourceDescription: "Internal lab stock for testing",
      growthStage: GrowthStage.VEGETATIVE,
    } as Parameters<typeof registerUnits>[1]);

    const admin = await getDashboard(lab.admin);
    expect(admin.view).toBe("admin");
    expect(admin.inventory.total).toBe(7); // the member's five plus the other experiment's two
    expect(admin.runningExperiments.map((e) => e.ecode).sort()).toEqual(["AB1", "OTH1"]);

    const member = await getDashboard(lab.member);
    expect(member.view).toBe("member");
    expect(member.inventory.total).toBe(5);
    expect(member.inventory.byLocation.map((l) => l.id)).not.toContain(lab.rooms[2].id);
    expect(member.runningExperiments.map((e) => e.ecode)).toEqual(["AB1"]);
    expect(member.runningExperimentCount).toBe(1);
    expect(member.onHold).toBe(2);
    if (member.recent.kind === "events") {
      expect(member.recent.events.map((e) => e.unitName)).not.toContain("Hidden");
    }

    // Someone in no experiment sees an empty dashboard rather than the laboratory.
    const outsider = await getDashboard(lab.outsider);
    expect(outsider.inventory.total).toBe(0);
    expect(outsider.runningExperiments).toEqual([]);
    expect(outsider.recent).toEqual({ kind: "events", events: [] });
  });

  it("gives only administrators the member overview, with each member's experiments and units", async () => {
    const admin = await getDashboard(lab.admin);
    expect(admin.members?.map((m) => m.name)).toEqual(["Admin", "Member", "Outsider", "Witness"]);
    const row = (name: string) => admin.members?.find((m) => m.name === name);
    expect(row("Member")).toMatchObject({ permissions: "REGULAR", experiments: 1, units: 5 });
    expect(row("Admin")).toMatchObject({ permissions: "ADMIN", experiments: 0, units: 0 });
    expect(row("Outsider")).toMatchObject({ experiments: 0, units: 0 });

    expect((await getDashboard(lab.member)).members).toBeNull();
  });

  it("is empty and calm for a laboratory with nothing in it", async () => {
    await resetDatabase();
    const fresh = await createLab();
    const data = await getDashboard(fresh.admin);
    expect(data).toMatchObject({ view: "admin", onHold: 0, runningExperimentCount: 1 }); // the fixture experiment, with no units
    expect(data.inventory).toMatchObject({ total: 0, byType: [], byStage: [], byLocation: [] });
    expect(data.recent).toEqual({ kind: "audit", entries: [] });
  });
});
