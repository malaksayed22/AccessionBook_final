import { beforeAll, describe, expect, it } from "vitest";
import { GrowthStage, HoldKind } from "@/generated/prisma/enums";
import { listCultivars } from "@/features/cultivar/queries";
import { getLocationSummary } from "@/features/location/queries";
import { placeHold } from "@/features/qa/service";
import { changeStage, destroyUnit, moveUnit } from "@/features/unit/service";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

process.env.LAB_TIMEZONE = "America/Toronto";

describe("cultivar card details and the location summary", () => {
  let lab: Lab;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    // Four units of one cultivar: two free in Room 1, one on hold in Room 2, one destroyed.
    for (const name of ["C1", "C2", "C3", "C4"]) ids[name] = (await registerOne(lab, { name })).id;
    await changeStage(lab.member, ids.C2!, { toStage: GrowthStage.FLOWERING });
    await moveUnit(lab.member, ids.C3!, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await placeHold(lab.member, ids.C3!, { reason: "Mildew", kind: HoldKind.HOLD });
    await destroyUnit(lab.admin, ids.C4!, {
      reason: "Destroyed per SOP-14",
    });
  });

  it("gives each cultivar its units by status, kind, stage and place", async () => {
    const { rows } = await listCultivars(lab.admin, {
      sort: "name",
      order: "asc",
      page: 1,
      limit: 25,
    });
    const row = rows.find((r) => r.id === lab.cultivar.id)!;
    expect(row.details.statuses).toEqual({ active: 2, onHold: 1, inactive: 0, destroyed: 1 });
    expect(row.details.types).toEqual([{ type: "PLANT", count: 4 }]);
    // Stages count what is still in inventory: two vegetative, one flowering on hold.
    expect(Object.fromEntries(row.details.stages.map((s) => [s.stage, s.count]))).toEqual({
      VEGETATIVE: 2,
      FLOWERING: 1,
    });
    expect(row.details.locations.map((l) => [l.name, l.count])).toEqual([
      ["Room 1", 2],
      ["Room 2", 1],
    ]);
    expect(row.details.lastActivity).toBeInstanceOf(Date);
    expect(row.details.createdAt).toBeInstanceOf(Date);
  });

  it("summarises one location: everything in it, and how much is the cultivar", async () => {
    const summary = await getLocationSummary(lab.admin, lab.rooms[1].id, lab.cultivar.id);
    expect(summary).toMatchObject({
      name: "Room 2",
      occupancy: 1,
      here: { active: 0, onHold: 1, types: [{ type: "PLANT", count: 1 }] },
      cultivar: { id: lab.cultivar.id, active: 0, onHold: 1 },
    });
    expect(summary?.experiments).toMatchObject([{ id: lab.experiment.id, count: 1 }]);

    const room1 = await getLocationSummary(lab.admin, lab.rooms[0].id);
    expect(room1).toMatchObject({ occupancy: 2, here: { active: 2, onHold: 0 }, cultivar: null });
    expect(await getLocationSummary(lab.admin, 999_999)).toBeNull();
  });
});
