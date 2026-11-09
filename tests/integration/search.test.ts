import { beforeEach, describe, expect, it } from "vitest";
import { HoldKind } from "@/generated/prisma/enums";
import { placeHold } from "@/features/qa/service";
import { destroyUnit } from "@/features/unit/service";
import {
  lookup,
  normalizeSearchText,
  searchAll,
  SEARCH_GROUP_LIMIT,
} from "@/features/search/queries";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

describe("normalizeSearchText", () => {
  it("trims, limits the length and refuses text that is too short", () => {
    expect(normalizeSearchText("  alpha  ")).toBe("alpha");
    expect(normalizeSearchText("a")).toBeUndefined();
    expect(normalizeSearchText("   ")).toBeUndefined();
    expect(normalizeSearchText(undefined)).toBeUndefined();
    expect(normalizeSearchText("x".repeat(500))).toHaveLength(100);
  });
});

describe("search", () => {
  let lab: Lab;
  const ids: Record<string, number> = {};

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    for (const name of ["Alpha-1", "Alpha-2", "Bravo_50%", "Charlie"]) {
      ids[name] = (await registerOne(lab, { name })).id;
    }
    await placeHold(lab.member, ids["Alpha-2"]!, { reason: "Mould", kind: HoldKind.HOLD });
    await destroyUnit(lab.admin, ids.Charlie!, {
      reason: "Failed germination, destroyed per SOP",
    });
  });

  it("groups units, experiments and cultivars with the full count of each", async () => {
    const results = await searchAll(lab.admin, "alpha");
    expect(results.query).toBe("alpha");
    expect(results.units.total).toBe(2);
    expect(results.units.hits.map((u) => u.name)).toEqual(["Alpha-1", "Alpha-2"]);
    expect(results.experiments.total).toBe(0);
    expect(results.cultivars.total).toBe(0);

    const byCultivar = await searchAll(lab.admin, "northern");
    expect(byCultivar.cultivars.hits.map((c) => c.name)).toEqual(["Northern Lights"]);
    // The cultivar and the experiment code also find the units that carry them.
    expect(byCultivar.units.total).toBe(4);
    expect((await searchAll(lab.admin, "ab1")).experiments.hits[0]).toMatchObject({ ecode: "AB1" });
  });

  it("gives each unit its status, type and place", async () => {
    const { units } = await searchAll(lab.admin, "alpha");
    expect(units.hits.map((u) => u.status)).toEqual(["active", "on-hold"]);
    expect(units.hits[0]).toMatchObject({
      type: "PLANT",
      cultivarName: "Northern Lights",
      experimentCode: "AB1",
      locationName: "Room 1",
    });
    expect((await searchAll(lab.admin, "charlie")).units.hits[0]?.status).toBe("destroyed");
  });

  it("matches without regard to case", async () => {
    expect((await searchAll(lab.admin, "ALPHA")).units.total).toBe(2);
    expect((await searchAll(lab.admin, "nOrThErN")).cultivars.total).toBe(1);
  });

  it("lists a limited number of hits but counts them all", async () => {
    for (let n = 1; n <= SEARCH_GROUP_LIMIT + 2; n += 1) {
      await registerOne(lab, { name: `Bulk-${String(n).padStart(2, "0")}` });
    }
    const { units } = await searchAll(lab.admin, "bulk-");
    expect(units.total).toBe(SEARCH_GROUP_LIMIT + 2);
    expect(units.hits).toHaveLength(SEARCH_GROUP_LIMIT);
    expect(units.hits[0]?.name).toBe("Bulk-01");
  });

  it("treats the text as text: % and _ are characters, quotes cannot break out", async () => {
    expect((await searchAll(lab.admin, "50%")).units.hits.map((u) => u.name)).toEqual([
      "Bravo_50%",
    ]);
    expect((await searchAll(lab.admin, "%%")).units.total).toBe(0);
    expect((await searchAll(lab.admin, "o_5")).units.hits.map((u) => u.name)).toEqual([
      "Bravo_50%",
    ]);
    expect((await searchAll(lab.admin, "a_p")).units.total).toBe(0); // "_" is not "any one character"
    const hostile = await searchAll(lab.admin, `'); DROP TABLE "BiologicalUnit"; --`);
    expect(hostile.units.total).toBe(0);
    expect(await prisma.biologicalUnit.count()).toBe(4);
  });

  it("searches organizations and members for administrators only", async () => {
    const admin = await searchAll(lab.admin, "supplier");
    expect(admin.organizations?.hits.map((o) => o.name)).toEqual(["Seed Supplier Inc."]);
    expect((await searchAll(lab.admin, "witness")).members?.hits.map((m) => m.name)).toEqual([
      "Witness",
    ]);
    expect((await searchAll(lab.admin, "outsider@example")).members?.total).toBe(1);

    const regular = await searchAll(lab.member, "supplier");
    expect(regular.organizations).toBeNull();
    expect(regular.members).toBeNull();
    expect((await searchAll(lab.member, "witness")).members).toBeNull();
  });

  describe("command palette lookup", () => {
    it("keeps the shape the palette reads", async () => {
      const found = await lookup(lab.member, "alpha");
      expect(found.units.map((u) => u.name)).toEqual(["Alpha-1", "Alpha-2"]);
      expect(found.units[0]).toMatchObject({ type: "PLANT", experiment: { ecode: "AB1" } });
      expect(found.experiments).toEqual([]);
      expect(found.cultivars).toEqual([]);
    });

    it("answers nothing to text that is too short", async () => {
      expect(await lookup(lab.member, "a")).toEqual({ units: [], experiments: [], cultivars: [] });
      expect(await lookup(lab.member, "  ")).toEqual({ units: [], experiments: [], cultivars: [] });
    });

    it("escapes wildcards here too", async () => {
      expect((await lookup(lab.member, "%%")).units).toEqual([]);
      expect((await lookup(lab.member, "50%")).units.map((u) => u.name)).toEqual(["Bravo_50%"]);
    });

    it("jumps to a unit typed by its number", async () => {
      const id = String(ids.Charlie);
      const padded = id.length < 2 ? `0${id}` : id;
      const found = await lookup(lab.member, padded);
      expect(found.units.some((u) => u.id === ids.Charlie)).toBe(true);
    });
  });
});
