import { beforeEach, describe, expect, it } from "vitest";
import { destroyUnit, moveUnit } from "@/features/unit/service";
import {
  getLocationOverview,
  listLocations,
  type LocationListParams,
} from "@/features/location/queries";
import {
  createLocation,
  reactivateLocation,
  retireLocation,
  updateLocation,
} from "@/features/location/service";
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

const base: LocationListParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);
const lastAudit = async () =>
  (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0]!;

describe("location list", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    // Room 1: 2 units, capacity 2 (full). Room 2: 1 unit, capacity 10. Room 3: none, no limit.
    await prisma.location.update({ where: { id: lab.rooms[0].id }, data: { capacity: 2 } });
    await prisma.location.update({
      where: { id: lab.rooms[1].id },
      data: { capacity: 10, address: "Building B", active: true },
    });
    await registerOne(lab, { name: "A1", locationId: lab.rooms[0].id });
    await registerOne(lab, { name: "A2", locationId: lab.rooms[0].id });
    await registerOne(lab, { name: "B1", locationId: lab.rooms[1].id });
  });

  it("counts the units in inventory per location, in the database", async () => {
    const { rows, total } = await listLocations(lab.admin, base);
    expect(total).toBe(3);
    expect(rows.map((r) => [r.name, r.units, r.capacity])).toEqual([
      ["Room 1", 2, 2],
      ["Room 2", 1, 10],
      ["Room 3", 0, null],
    ]);
    expect(rows[0]?.experiments).toBe(1);
  });

  it("does not count units that were destroyed or moved away", async () => {
    await destroyUnit(
      lab.admin,
      (await prisma.biologicalUnit.findFirstOrThrow({ where: { name: "A1" } })).id,
      {
        reason: "Failed germination test, destroyed per SOP",
      }
    );
    const a2 = await prisma.biologicalUnit.findFirstOrThrow({ where: { name: "A2" } });
    await moveUnit(lab.member, a2.id, { toLocationId: lab.rooms[2].id }, { requireScan: false });
    const { rows } = await listLocations(lab.admin, base);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.units]))).toEqual({
      "Room 1": 0,
      "Room 2": 1,
      "Room 3": 1,
    });
  });

  it("filters retired and active locations and searches name, address and notes", async () => {
    await prisma.location.update({ where: { id: lab.rooms[2].id }, data: { active: false } });
    expect(names((await listLocations(lab.admin, { ...base, status: "retired" })).rows)).toEqual([
      "Room 3",
    ]);
    expect((await listLocations(lab.admin, { ...base, status: "active" })).total).toBe(2);
    expect(names((await listLocations(lab.admin, { ...base, q: "building b" })).rows)).toEqual([
      "Room 2",
    ]);
    expect(names((await listLocations(lab.admin, { ...base, q: "ROOM 1" })).rows)).toEqual([
      "Room 1",
    ]);
  });

  it("treats search text as text, not as a pattern", async () => {
    expect((await listLocations(lab.admin, { ...base, q: "%" })).total).toBe(0);
    expect((await listLocations(lab.admin, { ...base, q: "_" })).total).toBe(0);
    expect(
      (await listLocations(lab.admin, { ...base, q: '\'; DROP TABLE "Location"; --' })).total
    ).toBe(0);
    expect((await listLocations(lab.admin, base)).total).toBe(3);
  });

  it("sorts by units and capacity (no limit last) and pages without repeating rows", async () => {
    expect(
      names((await listLocations(lab.admin, { ...base, sort: "units", order: "desc" })).rows)
    ).toEqual(["Room 1", "Room 2", "Room 3"]);
    expect(
      names((await listLocations(lab.admin, { ...base, sort: "capacity", order: "desc" })).rows)
    ).toEqual(["Room 2", "Room 1", "Room 3"]);
    expect(
      names((await listLocations(lab.admin, { ...base, sort: "capacity", order: "asc" })).rows)
    ).toEqual(["Room 1", "Room 2", "Room 3"]);

    const first = await listLocations(lab.admin, { ...base, limit: 2 });
    const second = await listLocations(lab.admin, { ...base, limit: 2, page: 2 });
    expect(first.total).toBe(3);
    expect([...names(first.rows), ...names(second.rows)]).toEqual(["Room 1", "Room 2", "Room 3"]);
  });

  it("summarises the laboratory", async () => {
    expect(await getLocationOverview(lab.admin)).toEqual({
      active: 3,
      retired: 0,
      unitsStored: 3,
      atCapacity: 1,
    });
  });
});

describe("location service", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("creates a location (admin only) with an audit entry", async () => {
    await expectCode(createLocation(lab.member, { name: "Vault", code: "VLT-9" }), "FORBIDDEN");
    const created = await createLocation(lab.admin, { name: "Vault", code: "VLT-9", capacity: 5 });
    expect(await prisma.location.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      name: "Vault",
      capacity: 5,
      active: true,
    });
    expect(await lastAudit()).toMatchObject({ entityType: "location", action: "create" });
  });

  it("refuses duplicate names regardless of case and points at the existing one", async () => {
    const error = await createLocation(lab.admin, { name: "room 1", code: "RM-9" }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("CONFLICT");
    expect((error as AppError).details).toEqual({ id: lab.rooms[0].id });
  });

  it("edits, records before and after, clears the capacity and reports no-ops", async () => {
    await updateLocation(lab.admin, lab.rooms[0].id, { capacity: 4, address: "Wing A" });
    expect((await lastAudit()).details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "capacity", from: null, to: "4" }),
        expect.objectContaining({ field: "address", from: null, to: "Wing A" }),
      ])
    );
    expect((await updateLocation(lab.admin, lab.rooms[0].id, { capacity: 4 })).unchanged).toBe(
      true
    );
    await updateLocation(lab.admin, lab.rooms[0].id, { capacity: null });
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: lab.rooms[0].id } })).capacity
    ).toBeNull();
    await expectCode(updateLocation(lab.member, lab.rooms[0].id, { name: "Hidden" }), "FORBIDDEN");
    await expectCode(updateLocation(lab.admin, lab.rooms[0].id, { name: "ROOM 2" }), "CONFLICT");
    await expectCode(updateLocation(lab.admin, 99999, { name: "Nowhere" }), "NOT_FOUND");
  });

  it("retires only an empty location, with a reason, and can bring it back", async () => {
    const unit = await registerOne(lab, { name: "P1", locationId: lab.rooms[0].id });
    await expectCode(
      retireLocation(lab.admin, lab.rooms[0].id, { reason: "Room closed" }),
      "LOCATION_NOT_EMPTY"
    );
    // The refusal rolled everything back: the room is still active.
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: lab.rooms[0].id } })).active
    ).toBe(true);
    await expectCode(
      retireLocation(lab.member, lab.rooms[2].id, { reason: "Room closed" }),
      "FORBIDDEN"
    );

    await retireLocation(lab.admin, lab.rooms[2].id, { reason: "Room closed for renovation" });
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: lab.rooms[2].id } })).active
    ).toBe(false);
    expect(await lastAudit()).toMatchObject({
      action: "retire",
      reason: "Room closed for renovation",
    });
    await expectCode(retireLocation(lab.admin, lab.rooms[2].id, { reason: "Again" }), "CONFLICT");

    // Once the unit moves out, the first room can go too.
    await moveUnit(lab.member, unit.id, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await retireLocation(lab.admin, lab.rooms[0].id, { reason: "Room closed for renovation" });

    await reactivateLocation(lab.admin, lab.rooms[2].id);
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: lab.rooms[2].id } })).active
    ).toBe(true);
    await expectCode(reactivateLocation(lab.admin, lab.rooms[2].id), "CONFLICT");
    await expectCode(reactivateLocation(lab.member, lab.rooms[0].id), "FORBIDDEN");
    expect(await verifyChain()).toEqual([]);
  });
});
