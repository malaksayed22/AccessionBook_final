import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthStage, UnitStateKind } from "@/generated/prisma/enums";
import { mergeGroup, splitGroup } from "@/features/unit/groups";
import { getUnitProfile, listUnits } from "@/features/unit/queries";
import { changeStage } from "@/features/unit/service";
import { runReport } from "@/lib/reports";
import { zonedDateKey } from "@/lib/lab-time";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase } from "./helpers";

vi.hoisted(() => {
  process.env.LAB_TIMEZONE = "America/Toronto";
});

type Lab = Awaited<ReturnType<typeof createLab>>;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

const plantsOf = async (unitId: number) =>
  (
    await prisma.biologicalUnit.findUniqueOrThrow({
      where: { id: unitId },
      include: { currentState: true },
    })
  ).currentState;

describe("plant groups", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const group = (name: string, plantCount: number) =>
    registerOne(lab, { name, plantCount, growthStage: GrowthStage.VEGETATIVE } as never);

  it("registers a group, splits part of it into another room, and merges it back", async () => {
    const batch = await group("BATCH-1", 50);
    expect((await plantsOf(batch.id))?.plantCount).toBe(50);
    expect((await getUnitProfile(lab.member, batch.id))?.current?.plantCount).toBe(50);

    const split = await splitGroup(lab.member, batch.id, {
      plants: 20,
      locationId: lab.rooms[1].id,
    });
    expect(split).toMatchObject({ group: { name: "BATCH-1-G-1" }, left: 30 });
    expect(await plantsOf(batch.id)).toMatchObject({
      kind: UnitStateKind.REGROUPED,
      plantCount: 30,
    });
    const child = await prisma.biologicalUnit.findUniqueOrThrow({
      where: { id: split.group.id },
      include: { currentState: true },
    });
    expect(child).toMatchObject({ sourceType: "SPLIT", sourceParentUnitId: batch.id });
    expect(child.currentState).toMatchObject({ plantCount: 20, locationId: lab.rooms[1].id });

    const merged = await mergeGroup(lab.member, child.id, { intoUnitId: batch.id });
    expect(merged).toMatchObject({ into: { id: batch.id }, plants: 50 });
    expect(await plantsOf(child.id)).toMatchObject({ kind: UnitStateKind.MERGED });
    const profile = (await getUnitProfile(lab.member, child.id))!;
    expect(profile.terminal).toBe("MERGED");
    expect(profile.merge?.into).toEqual({ id: batch.id, name: "BATCH-1" });

    // The merged group has nothing left: out of the active list, in "nothing left".
    const base = { sort: "name", order: "asc", page: 1, limit: 50 } as const;
    const names = async (status: "active" | "empty") =>
      (await listUnits(lab.member, { ...base, status } as never)).rows.map(
        (u: { name: string }) => u.name
      );
    expect(await names("active")).toEqual(["BATCH-1"]);
    expect(await names("empty")).toEqual(["BATCH-1-G-1"]);
  });

  it("refuses a split of every plant, and a merge across stages or into itself", async () => {
    const batch = await group("BATCH-2", 10);
    expect((await failure(splitGroup(lab.member, batch.id, { plants: 10 }))).details).toMatchObject(
      {
        reason: "splitTooLarge",
      }
    );
    const other = await group("BATCH-3", 5);
    await changeStage(lab.member, other.id, { toStage: "FLOWERING" });
    expect(
      (await failure(mergeGroup(lab.member, batch.id, { intoUnitId: other.id }))).details
    ).toMatchObject({
      reason: "mergeNotAlike",
    });
    expect(
      (await failure(mergeGroup(lab.member, batch.id, { intoUnitId: batch.id }))).details
    ).toMatchObject({
      reason: "mergeIntoItself",
    });
  });

  it("reports plants per group on the CTLS return, and regrouping books nothing", async () => {
    const batch = await group("BATCH-4", 40);
    const split = await splitGroup(lab.member, batch.id, { plants: 15 });
    const other = await group("BATCH-5", 5);
    await mergeGroup(lab.member, split.group.id, { intoUnitId: other.id });

    const [year, month] = zonedDateKey(new Date(), "America/Toronto").split("-").map(Number);
    const report = await runReport("ctls-monthly", { year, month });
    expect(report.ctls?.reconciles).toBe(true);
    const vegetative = report.ctls?.classes.find((c) => c.id === "vegetativePlants");
    // Internal stock registered this month is an "other" addition; the split and merge add nothing.
    expect(
      Object.fromEntries(Object.entries(vegetative?.lines ?? {}).filter(([, v]) => v !== 0))
    ).toEqual({ additionsOther: 45, closing: 45 });
  });
});
