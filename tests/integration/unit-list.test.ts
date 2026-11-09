import { beforeEach, describe, expect, it } from "vitest";
import { HoldKind } from "@/generated/prisma/enums";
import {
  getUnitStatusCounts,
  listLocationOptions,
  listUnits,
  type UnitListParams,
} from "@/features/unit/queries";
import { placeHold } from "@/features/qa/service";
import { destroyUnit, moveUnit } from "@/features/unit/service";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const base: UnitListParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe("listUnits", () => {
  let lab: Lab;
  let ids: Record<string, number>;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    ids = {};
    for (const [name, room] of [
      ["Alpha", 0],
      ["Bravo", 1],
      ["Charlie", 1],
      ["Delta", 2],
    ] as const) {
      ids[name] = (await registerOne(lab, { name, locationId: lab.rooms[room].id })).id;
    }
    await placeHold(lab.member, ids.Bravo!, { reason: "Suspected mould", kind: HoldKind.HOLD });
    await placeHold(lab.member, ids.Charlie!, {
      reason: "Cross contamination",
      kind: HoldKind.HOLD,
    });
    await destroyUnit(lab.admin, ids.Delta!, {
      reason: "Failed germination test, destroyed per SOP",
    });
  });

  it("returns every unit with the right status", async () => {
    const { rows, total } = await listUnits(lab.admin, base);
    expect(total).toBe(4);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.status]))).toEqual({
      Alpha: "active",
      Bravo: "on-hold",
      Charlie: "on-hold",
      Delta: "destroyed",
    });
  });

  it("filters by status, in the database", async () => {
    // Active means not on hold and not destroyed (shipping is not a status).
    expect(names((await listUnits(lab.admin, { ...base, status: "active" })).rows)).toEqual([
      "Alpha",
    ]);
    expect(names((await listUnits(lab.admin, { ...base, status: "hold" })).rows)).toEqual([
      "Bravo",
      "Charlie",
    ]);
    expect(names((await listUnits(lab.admin, { ...base, status: "destroyed" })).rows)).toEqual([
      "Delta",
    ]);
  });

  it("counts units by status for the cards, applying every filter but the status", async () => {
    // Alpha is active, Bravo and Charlie are on hold, Delta is destroyed.
    expect(await getUnitStatusCounts(lab.admin, {})).toEqual({
      active: 1,
      hold: 2,
      empty: 0,
      destroyed: 1,
    });
    // Room 2 holds Bravo and Charlie, both held; the counts follow the other filters.
    expect(await getUnitStatusCounts(lab.admin, { locationId: lab.rooms[1].id })).toEqual({
      active: 0,
      hold: 2,
      empty: 0,
      destroyed: 0,
    });
    expect(await getUnitStatusCounts(lab.admin, { q: "nothing like this" })).toEqual({
      active: 0,
      hold: 0,
      empty: 0,
      destroyed: 0,
    });
  });

  it("filters by location and type", async () => {
    expect(
      names((await listUnits(lab.admin, { ...base, locationId: lab.rooms[1].id })).rows)
    ).toEqual(["Bravo", "Charlie"]);
    expect((await listUnits(lab.admin, { ...base, type: "SEEDLOT" })).total).toBe(0);
    expect((await listUnits(lab.admin, { ...base, type: "PLANT" })).total).toBe(4);
  });

  it("searches name, cultivar, experiment and location, ignoring case", async () => {
    expect(names((await listUnits(lab.admin, { ...base, q: "alph" })).rows)).toEqual(["Alpha"]);
    expect((await listUnits(lab.admin, { ...base, q: "NORTHERN" })).total).toBe(4);
    expect((await listUnits(lab.admin, { ...base, q: "ab1" })).total).toBe(4);
    expect(names((await listUnits(lab.admin, { ...base, q: "room 3" })).rows)).toEqual(["Delta"]);
    expect((await listUnits(lab.admin, { ...base, q: "nothing like this" })).total).toBe(0);
  });

  it("treats search text as text, not as a pattern", async () => {
    expect((await listUnits(lab.admin, { ...base, q: "%" })).total).toBe(0);
    expect(
      (await listUnits(lab.admin, { ...base, q: '\'; DROP TABLE "BiologicalUnit"; --' })).total
    ).toBe(0);
    expect((await listUnits(lab.admin, base)).total).toBe(4);
  });

  it("sorts both ways and pages without repeating or skipping rows", async () => {
    expect(names((await listUnits(lab.admin, { ...base, order: "desc" })).rows)).toEqual([
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
    ]);
    const first = await listUnits(lab.admin, { ...base, limit: 3 });
    const second = await listUnits(lab.admin, { ...base, limit: 3, page: 2 });
    expect(first.total).toBe(4);
    expect([...names(first.rows), ...names(second.rows)]).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
    ]);
  });

  it("sorts by last update, location and cultivar", async () => {
    await moveUnit(
      lab.member,
      ids.Alpha!,
      { toLocationId: lab.rooms[2].id },
      { requireScan: false }
    );
    const byDate = await listUnits(lab.admin, { ...base, sort: "date", order: "desc" });
    expect(byDate.rows[0]?.name).toBe("Alpha");
    const byLocation = await listUnits(lab.admin, { ...base, sort: "location", order: "asc" });
    expect(byLocation.rows.map((r) => r.locationName)).toEqual([
      "Room 2",
      "Room 2",
      "Room 3",
      "Room 3",
    ]);
    expect((await listUnits(lab.admin, { ...base, sort: "cultivar" })).total).toBe(4);
  });

  it("offers active locations, plus a retired one if it is selected", async () => {
    await (
      await import("@/server/db")
    ).prisma.location.update({
      where: { id: lab.rooms[2].id },
      data: { active: false },
    });
    expect((await listLocationOptions()).map((l) => l.name)).toEqual(["Room 1", "Room 2"]);
    expect((await listLocationOptions(lab.rooms[2].id)).map((l) => l.name)).toEqual([
      "Room 1",
      "Room 2",
      "Room 3",
    ]);
  });
});
