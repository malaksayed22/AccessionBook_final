import { beforeEach, describe, expect, it } from "vitest";
import { UnitType } from "@/generated/prisma/enums";
import { listUnits } from "@/features/unit/queries";
import { deleteView, listViews, saveView } from "@/features/view/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const LIST = { sort: "name", order: "asc", page: 1, limit: 50 } as const;

describe("table views", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("keeps each member's saved views to themself, replacing one saved under the same name", async () => {
    const first = await saveView(lab.member, {
      list: "units",
      name: "On hold",
      query: "?status=hold&page=4&hide=cultivar",
    });
    expect(first.query).toBe("hide=cultivar&status=hold");
    await saveView(lab.member, { list: "units", name: "On hold", query: "status=hold" });
    await saveView(lab.member, { list: "units", name: "By room", query: "group=location" });
    await saveView(lab.outsider, { list: "units", name: "Mine", query: "type=PLANT" });

    expect(await listViews(lab.member, "units")).toEqual([
      expect.objectContaining({ name: "By room", query: "group=location" }),
      expect.objectContaining({ name: "On hold", query: "status=hold" }),
    ]);
    // Nobody deletes another member's view.
    await expect(deleteView(lab.outsider, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteView(lab.member, first.id);
    expect((await listViews(lab.member, "units")).map((v) => v.name)).toEqual(["By room"]);
    expect(await prisma.savedView.count()).toBe(2);
  });

  it("keeps the views of each list apart, under the same name", async () => {
    await saveView(lab.member, {
      list: "experiments",
      name: "Mine",
      query: "view=table&hide=team",
    });
    await saveView(lab.member, { list: "shipments", name: "Mine", query: "direction=OUTBOUND" });
    expect((await listViews(lab.member, "experiments")).map((v) => v.query)).toEqual([
      "hide=team&view=table",
    ]);
    expect((await listViews(lab.member, "shipments")).map((v) => v.query)).toEqual([
      "direction=OUTBOUND",
    ]);
    expect(await listViews(lab.member, "units")).toEqual([]);
  });

  it("groups the units list, and lists only the rows chosen for an export", async () => {
    const plant = await registerOne(lab, { name: "B-PLANT" });
    const seeds = await registerOne(lab, {
      name: "A-SEEDS",
      type: UnitType.SEEDLOT,
      seedCount: 100,
      locationId: lab.rooms[1].id,
    } as never);
    const culture = await registerOne(lab, { name: "C-CULTURE", type: UnitType.CULTURE } as never);

    const byLocation = await listUnits(lab.member, { ...LIST, group: "location" });
    expect(byLocation.rows.map((u) => [u.locationName, u.name])).toEqual([
      ["Room 1", "B-PLANT"],
      ["Room 1", "C-CULTURE"],
      ["Room 2", "A-SEEDS"],
    ]);

    const chosen = await listUnits(lab.member, { ...LIST, ids: [seeds.id, culture.id] });
    expect(chosen.rows.map((u) => u.name)).toEqual(["A-SEEDS", "C-CULTURE"]);
    // Choosing a row does not widen what the reader may see.
    expect((await listUnits(lab.outsider, { ...LIST, ids: [plant.id] })).rows).toEqual([]);
  });
});
