import { beforeEach, describe, expect, it } from "vitest";
import { HoldKind, TestPanel } from "@/generated/prisma/enums";
import {
  getCultivar,
  listCultivarIncidents,
  listCultivarTests,
  listCultivarUnits,
  listCultivars,
  type CultivarListParams,
} from "@/features/cultivar/queries";
import { createCultivar, updateCultivar } from "@/features/cultivar/service";
import { openIncident, placeHold, recordLabTest, voidLabTest } from "@/features/qa/service";
import { destroyUnit } from "@/features/unit/service";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase, verifyChain } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const base: CultivarListParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe("cultivar queries", () => {
  let lab: Lab;
  let unused: { id: number };
  let units: Record<string, number>;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab(); // "Northern Lights"
    await prisma.cultivar.update({
      where: { id: lab.cultivar.id },
      data: { code: "NL-1", commonName: "NL", category: "Indica dominant", targetThc: 18.5 },
    });
    unused = await prisma.cultivar.create({
      data: { name: "Blue Dream", commonName: "Azure", comment: "50% sativa notes", targetThc: 22 },
    });
    units = {};
    for (const name of ["N1", "N2", "N3", "N4"]) {
      units[name] = (await registerOne(lab, { name })).id;
    }
    await placeHold(lab.member, units.N2!, { reason: "Suspected mould", kind: HoldKind.HOLD });
    await destroyUnit(lab.admin, units.N3!, {
      reason: "Failed germination test, destroyed per SOP",
    });
  });

  it("counts total, active and held units, experiments and locations", async () => {
    const { rows } = await listCultivars(lab.admin, base);
    const nl = rows.find((r) => r.name === "Northern Lights")!;
    expect(nl.stats).toEqual({
      totalUnits: 4,
      activeUnits: 3,
      onHold: 1,
      experiments: 1,
      locations: 1,
    });
    expect(rows.find((r) => r.name === "Blue Dream")?.stats.totalUnits).toBe(0);
  });

  it("filters by use and searches several fields, ignoring case", async () => {
    expect(names((await listCultivars(lab.admin, { ...base, usage: "used" })).rows)).toEqual([
      "Northern Lights",
    ]);
    expect(names((await listCultivars(lab.admin, { ...base, usage: "unused" })).rows)).toEqual([
      "Blue Dream",
    ]);
    expect(names((await listCultivars(lab.admin, { ...base, q: "nl-1" })).rows)).toEqual([
      "Northern Lights",
    ]);
    expect(names((await listCultivars(lab.admin, { ...base, q: "AZURE" })).rows)).toEqual([
      "Blue Dream",
    ]);
    expect(names((await listCultivars(lab.admin, { ...base, q: "indica" })).rows)).toEqual([
      "Northern Lights",
    ]);
  });

  it("treats search text as text, not as a pattern", async () => {
    // "50% sativa" exists; a bare % must not match everything.
    expect(names((await listCultivars(lab.admin, { ...base, q: "50%" })).rows)).toEqual([
      "Blue Dream",
    ]);
    expect((await listCultivars(lab.admin, { ...base, q: "%" })).total).toBe(1);
    expect((await listCultivars(lab.admin, { ...base, q: "_" })).total).toBe(0);
    expect(
      (await listCultivars(lab.admin, { ...base, q: '\'; DROP TABLE "Cultivar"; --' })).total
    ).toBe(0);
  });

  it("sorts by units and target THC (unknown last) and pages stably", async () => {
    expect(
      names((await listCultivars(lab.admin, { ...base, sort: "units", order: "desc" })).rows)
    ).toEqual(["Northern Lights", "Blue Dream"]);
    expect(
      names((await listCultivars(lab.admin, { ...base, sort: "thc", order: "desc" })).rows)
    ).toEqual(["Blue Dream", "Northern Lights"]);
    const first = await listCultivars(lab.admin, { ...base, limit: 1 });
    const second = await listCultivars(lab.admin, { ...base, limit: 1, page: 2 });
    expect(first.total).toBe(2);
    expect([...names(first.rows), ...names(second.rows)]).toEqual([
      "Blue Dream",
      "Northern Lights",
    ]);
  });

  it("returns one cultivar with its stats, or null", async () => {
    expect((await getCultivar(lab.admin, lab.cultivar.id))?.stats.activeUnits).toBe(3);
    expect(await getCultivar(lab.admin, 99999)).toBeNull();
  });

  it("lists the units of a cultivar a page at a time with their status", async () => {
    const params = { sort: "name", order: "asc", page: 1, limit: 3 } as const;
    const first = await listCultivarUnits(lab.admin, lab.cultivar.id, params);
    const second = await listCultivarUnits(lab.admin, lab.cultivar.id, { ...params, page: 2 });
    expect(first.total).toBe(4);
    expect([...first.rows, ...second.rows].map((u) => [u.name, u.status])).toEqual([
      ["N1", "active"],
      ["N2", "on-hold"],
      ["N3", "destroyed"],
      ["N4", "active"],
    ]);
    expect((await listCultivarUnits(lab.admin, unused.id, params)).total).toBe(0);
  });

  it("lists incidents and tests, newest first, leaving voided ones out", async () => {
    await openIncident(lab.member, {
      title: "Mites found",
      description: "Spider mites on the canopy",
      severity: "MAJOR",
      cultivarId: lab.cultivar.id,
    } as Parameters<typeof openIncident>[1]);
    await recordLabTest(lab.member, units.N1!, {
      panel: TestPanel.POTENCY,
      analyte: "THC",
      value: 15,
    });
    const wrong = await recordLabTest(lab.member, units.N4!, {
      panel: TestPanel.TERPENES,
      analyte: "Limonene",
      value: 1,
    });
    await voidLabTest(lab.admin, wrong.testId, { reason: "Entered on the wrong unit" });

    const incidents = await listCultivarIncidents(lab.admin, lab.cultivar.id);
    expect(incidents.total).toBe(1);
    expect(incidents.rows[0]).toMatchObject({ title: "Mites found", severity: "MAJOR" });
    const tests = await listCultivarTests(lab.admin, lab.cultivar.id);
    expect(tests.total).toBe(1);
    expect(tests.rows[0]).toMatchObject({ analyte: "THC", unit: { name: "N1" } });
    expect((await listCultivarTests(lab.admin, unused.id)).total).toBe(0);
  });
});

describe("cultivar service", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("adds a cultivar (admin only) and audits it", async () => {
    await expectCode(createCultivar(lab.member, { name: "Sour Diesel" }), "FORBIDDEN");
    const created = await createCultivar(lab.admin, {
      name: "Sour Diesel",
      targetThc: 20,
      targetCbd: null,
    });
    // The code is made by the database: the next CV- number.
    expect(await prisma.cultivar.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      name: "Sour Diesel",
      code: expect.stringMatching(/^CV-\d{3,}$/),
      targetThc: 20,
      targetCbd: null,
    });
    expect(
      (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0]
    ).toMatchObject({ entityType: "cultivar", action: "create" });
  });

  it("refuses a duplicate name in any case and points at the existing cultivar", async () => {
    const error = await createCultivar(lab.admin, { name: "northern lights" }).catch((e) => e);
    expect((error as AppError).code).toBe("CONFLICT");
    expect((error as AppError).details).toEqual({ id: lab.cultivar.id });
  });

  it("edits with before and after, clears values, and rejects no-ops, strangers and clashes", async () => {
    const id = lab.cultivar.id;
    const result = await updateCultivar(lab.admin, id, {
      targetThc: 18,
      comment: "Keeper",
    });
    expect(result.unchanged).toBe(false);
    const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0]!;
    expect((entry.details as Array<{ field: string }>).map((c) => c.field).sort()).toEqual([
      "comment",
      "targetThc",
    ]);
    expect((await updateCultivar(lab.admin, id, { targetThc: 18 })).unchanged).toBe(true);
    await updateCultivar(lab.admin, id, { targetThc: null });
    expect((await prisma.cultivar.findUniqueOrThrow({ where: { id } })).targetThc).toBeNull();

    const other = await createCultivar(lab.admin, { name: "Other" });
    await expectCode(updateCultivar(lab.admin, other.id, { name: "NORTHERN LIGHTS" }), "CONFLICT");
    await expectCode(updateCultivar(lab.member, id, { name: "Hidden" }), "FORBIDDEN");
    await expectCode(updateCultivar(lab.admin, 99999, { name: "Nowhere" }), "NOT_FOUND");
    expect(await verifyChain()).toEqual([]);
  });
});
