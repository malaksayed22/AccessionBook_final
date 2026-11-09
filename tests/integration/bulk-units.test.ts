import { beforeEach, describe, expect, it } from "vitest";
import { ActivityType, GrowthStage, UnitStateKind } from "@/generated/prisma/enums";
import { applyBulk } from "@/features/unit/bulk";
import { bulkUnitsSchema } from "@/features/unit/schemas";
import { zonedDateKey } from "@/lib/lab-time";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

process.env.LAB_TIMEZONE = "America/Toronto";

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("bulk actions on units", () => {
  let lab: Lab;
  let ids: number[];

  const kinds = async (unitId: number) =>
    (await prisma.unitState.findMany({ where: { unitId }, orderBy: { sequence: "asc" } })).map(
      (s) => s.kind
    );

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    ids = [];
    for (const name of ["B1", "B2", "B3"]) ids.push((await registerOne(lab, { name })).id);
  });

  it("records one pesticide application on every selected unit, held ones included", async () => {
    await applyBulk(lab.member, { action: "hold", unitIds: [ids[0]!], reason: "Powdery mildew" });
    const yesterday = zonedDateKey(new Date(Date.now() - 86_400_000), "America/Toronto");
    const input = bulkUnitsSchema.parse({
      action: "activity",
      unitIds: ids,
      type: "PESTICIDE",
      title: "Foliar spray against powdery mildew",
      product: "Neem oil 70%",
      pcpNumber: "30500",
      amount: "2.5",
      amountUnit: "L",
      method: "Foliar spray",
      effectiveAt: yesterday,
    });
    const result = await applyBulk(lab.member, input);
    expect(result.count).toBe(3);

    const rows = await prisma.unitActivity.findMany({ where: { unitId: { in: ids } } });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        type: ActivityType.PESTICIDE,
        product: "Neem oil 70%",
        pcpNumber: "30500",
        amountUnit: "L",
        method: "Foliar spray",
      });
      expect(Number(row.amount)).toBe(2.5);
      expect(row.date.getTime()).toBeLessThan(Date.now() - 3_600_000);
    }
    // An activity is not a state change: the units' histories of events are unchanged.
    expect(await kinds(ids[1]!)).toEqual([UnitStateKind.CREATED]);
    const audits = await prisma.auditLog.findMany({ where: { action: "activity" } });
    expect(audits).toHaveLength(3);
    expect(audits[0]?.summary).toContain("Neem oil 70%, PCP 30500, 2.5 L");
  });

  it("refuses a pesticide without its PCP registration number, and an activity in the future", async () => {
    const pesticide = {
      action: "activity",
      unitIds: ids,
      type: "PESTICIDE",
      title: "Spray",
      product: "Neem oil",
      amount: 1,
      amountUnit: "L",
    };
    const missing = bulkUnitsSchema.safeParse(pesticide);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((issue) => issue.path.join("."))).toEqual(["pcpNumber"]);
    expect(
      bulkUnitsSchema.safeParse({
        ...pesticide,
        type: "SCOUTING",
        product: undefined,
        amount: undefined,
      }).success
    ).toBe(true);

    const tomorrow = zonedDateKey(new Date(Date.now() + 2 * 86_400_000), "America/Toronto");
    const error = await failure(
      applyBulk(
        lab.member,
        bulkUnitsSchema.parse({ ...pesticide, pcpNumber: "30500", effectiveAt: tomorrow })
      )
    );
    expect(error.details).toMatchObject({ reason: "activityInFuture" });
    expect(await prisma.unitActivity.count()).toBe(0);
  });

  it("moves every selected unit, each with its own history and audit entry", async () => {
    const result = await applyBulk(lab.member, {
      action: "move",
      unitIds: ids,
      toLocationId: lab.rooms[1].id,
    });
    expect(result.count).toBe(3);
    for (const id of ids) {
      expect(await kinds(id)).toEqual([UnitStateKind.CREATED, UnitStateKind.MOVED]);
      const unit = await prisma.biologicalUnit.findUniqueOrThrow({
        where: { id },
        include: { currentState: true },
      });
      expect(unit.currentState?.locationId).toBe(lab.rooms[1].id);
    }
    const audits = await prisma.auditLog.count({ where: { action: "transfer" } });
    expect(audits).toBe(3);
  });

  it("changes the stage of all of them, and holds or destroys them with one reason", async () => {
    await applyBulk(lab.member, { action: "stage", unitIds: ids, toStage: GrowthStage.FLOWERING });
    for (const id of ids) expect(await kinds(id)).toContain(UnitStateKind.STAGE_CHANGED);

    await applyBulk(lab.member, { action: "hold", unitIds: [ids[0]!, ids[1]!], reason: "Mildew" });
    expect(await prisma.unitHold.count({ where: { releasedAt: null } })).toBe(2);

    await applyBulk(lab.admin, {
      action: "destroy",
      unitIds: [ids[2]!],
      reason: "Destroyed per SOP-14",
    });
    expect(await kinds(ids[2]!)).toContain(UnitStateKind.DESTROYED);
    // A destruction records who did it and why, with no witness.
    const destroyed = await prisma.unitState.findFirstOrThrow({
      where: { unitId: ids[2]!, kind: UnitStateKind.DESTROYED },
    });
    expect(destroyed).toMatchObject({ witnessId: null, recordedById: lab.admin.id });
  });

  it("lets members of the experiment destroy, but not someone outside it", async () => {
    const error = await failure(
      applyBulk(lab.outsider, { action: "destroy", unitIds: ids, reason: "Not allowed to do this" })
    );
    expect(error.code).toBe("FORBIDDEN");
    for (const id of ids) expect(await kinds(id)).not.toContain(UnitStateKind.DESTROYED);

    await applyBulk(lab.member, { action: "destroy", unitIds: ids, reason: "Failed QC" });
    for (const id of ids) expect(await kinds(id)).toContain(UnitStateKind.DESTROYED);
  });

  it("is all or nothing: one unit that cannot take the action changes nothing, and is named", async () => {
    await applyBulk(lab.member, { action: "hold", unitIds: [ids[1]!], reason: "Under inspection" });

    const error = await failure(
      applyBulk(lab.member, {
        action: "move",
        unitIds: ids,
        toLocationId: lab.rooms[2].id,
      })
    );
    expect(error.code).toBe("UNIT_ON_HOLD");
    expect(error.details).toMatchObject({ bulkUnit: "B2" });
    for (const id of ids) expect(await kinds(id)).not.toContain(UnitStateKind.MOVED);
    expect(await prisma.auditLog.count({ where: { action: "transfer" } })).toBe(0);
  });

  it("refuses units the person may not edit, and unknown units, and applies nothing", async () => {
    const error = await failure(
      applyBulk(lab.outsider, {
        action: "hold",
        unitIds: ids,
        reason: "Not mine to hold",
      })
    );
    expect(error.code).toBe("FORBIDDEN");
    expect(await prisma.unitHold.count()).toBe(0);

    await failure(
      applyBulk(lab.member, { action: "hold", unitIds: [ids[0]!, 999_999], reason: "Ghost" })
    );
    expect(await prisma.unitHold.count()).toBe(0);
  });

  it("counts a unit once, however often it is listed", async () => {
    const result = await applyBulk(lab.member, {
      action: "hold",
      unitIds: [ids[0]!, ids[0]!, ids[0]!],
      reason: "Listed three times",
    });
    expect(result.count).toBe(1);
    expect(await prisma.unitHold.count()).toBe(1);
  });
  it("releases several holds at once, for administrators only, with the reason on each unit", async () => {
    await applyBulk(lab.member, { action: "hold", unitIds: ids, reason: "Suspected mildew" });
    const release = {
      action: "release" as const,
      unitIds: ids,
      reason: "Scouting report clear, no mildew found",
    };
    expect((await failure(applyBulk(lab.member, release))).code).toBe("FORBIDDEN");

    expect((await applyBulk(lab.admin, release)).count).toBe(3);
    const open = await prisma.unitHold.count({ where: { unitId: { in: ids }, releasedAt: null } });
    expect(open).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "release" } })).toBe(3);

    // All or nothing: a unit that is no longer on hold stops the whole batch.
    expect((await failure(applyBulk(lab.admin, release))).code).toBe("CONFLICT");
  });
});
