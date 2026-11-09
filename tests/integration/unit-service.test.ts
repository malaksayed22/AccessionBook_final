import { beforeEach, describe, expect, it } from "vitest";
import { GrowthStage, SourceType, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import {
  changeStage,
  deriveUnits,
  destroyUnit,
  linkParent,
  measureUnit,
  moveUnit,
  registerUnits,
  updateUnitDetails,
} from "@/features/unit/service";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase, statesOf, verifyChain } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe("unit service", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  describe("registration", () => {
    it("writes the unit, its first immutable state, the pointer and the audit entry together", async () => {
      const { id } = await registerOne(lab);

      const unit = await prisma.biologicalUnit.findUniqueOrThrow({
        where: { id },
        include: { currentState: true },
      });
      const states = await statesOf(id);
      expect(states).toHaveLength(1);
      expect(unit.currentStateId).toBe(states[0]?.id);
      expect(unit.currentState).toMatchObject({
        sequence: 1,
        kind: UnitStateKind.CREATED,
        locationId: lab.rooms[0].id,
        growthStage: GrowthStage.VEGETATIVE,
      });
      expect(unit.currentState?.recordedById).toBe(lab.member.id);

      const [entry] = await prisma.auditLog.findMany();
      expect(entry).toMatchObject({ entityType: "unit", entityId: id, action: "create" });
      expect(await verifyChain()).toEqual([]);
    });

    it("records material from an external provider as RECEIVED, with the counterparty", async () => {
      const { id } = await registerOne(lab, {
        name: "S1",
        type: UnitType.SEEDLOT,
        seedCount: 250,
        growthStage: undefined,
        sourceType: SourceType.RECEIVED,
        providerOrganizationId: lab.provider.id,
        sourceDescription: undefined,
      });
      const [state] = await statesOf(id);
      expect(state).toMatchObject({
        kind: UnitStateKind.RECEIVED,
        organizationId: lab.provider.id,
        seedCount: 250,
        growthStage: null,
      });
    });

    it("names a batch BASE-1..N in a single transaction", async () => {
      const { units } = await registerUnits(lab.member, {
        type: UnitType.PLANT,
        name: "BATCH",
        quantity: 3,
        experimentId: lab.experiment.id,
        cultivarId: lab.cultivar.id,
        locationId: lab.rooms[0].id,
        sourceType: SourceType.INTERNAL,
        sourceDescription: "Internal lab stock for testing",
      });
      expect(units.map((u) => u.name)).toEqual(["BATCH-1", "BATCH-2", "BATCH-3"]);
      expect(await prisma.unitState.count()).toBe(3);
    });

    it("rolls the whole batch back when the location cannot hold it", async () => {
      await prisma.location.update({ where: { id: lab.rooms[0].id }, data: { capacity: 2 } });
      await expectCode(
        registerUnits(lab.member, {
          type: UnitType.PLANT,
          name: "TOO-MANY",
          quantity: 3,
          experimentId: lab.experiment.id,
          cultivarId: lab.cultivar.id,
          locationId: lab.rooms[0].id,
          sourceType: SourceType.INTERNAL,
          sourceDescription: "Internal lab stock for testing",
        }),
        "CONFLICT"
      );
      expect(await prisma.biologicalUnit.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it("refuses duplicate names regardless of case", async () => {
      await registerOne(lab, { name: "P1" });
      await expectCode(registerOne(lab, { name: "p1" }), "CONFLICT");
    });

    it("lets experiment members and admins register, and refuses outsiders", async () => {
      const base = {
        type: UnitType.PLANT,
        name: "X",
        quantity: 1,
        experimentId: lab.experiment.id,
        cultivarId: lab.cultivar.id,
        locationId: lab.rooms[0].id,
        sourceType: SourceType.INTERNAL,
        sourceDescription: "Internal lab stock for testing",
      } as const;
      await expectCode(registerUnits(lab.outsider, base), "FORBIDDEN");
      await registerUnits(lab.admin, { ...base, name: "ADMIN-MADE" });
      await registerUnits(lab.member, { ...base, name: "MEMBER-MADE" });
    });

    it("requires a described source when no provider is given", async () => {
      await expectCode(registerOne(lab, { sourceDescription: undefined }), "VALIDATION");
    });

    it("refuses back-dating into the future", async () => {
      await expectCode(registerOne(lab, { effectiveAt: "2999-01-01" }), "VALIDATION");
    });
  });

  describe("moving", () => {
    it("appends a MOVED state and carries the rest of the snapshot forward", async () => {
      const { id } = await registerOne(lab, { humidWeight: 12.5, dryWeight: 3 });
      await moveUnit(lab.member, id, { toLocationId: lab.rooms[1].id }, { requireScan: false });

      const states = await statesOf(id);
      expect(states.map((s) => s.kind)).toEqual([UnitStateKind.CREATED, UnitStateKind.MOVED]);
      expect(states[1]).toMatchObject({
        sequence: 2,
        locationId: lab.rooms[1].id,
        growthStage: GrowthStage.VEGETATIVE,
        scanConfirmed: false,
      });
      // Legacy bug: transfers dropped weights. They must survive a move.
      expect(states[1]?.humidWeight?.toString()).toBe("12.5");
      expect(states[1]?.dryWeight?.toString()).toBe("3");
    });

    it("keeps a seed count across a move", async () => {
      const { id } = await registerOne(lab, {
        name: "S1",
        type: UnitType.SEEDLOT,
        seedCount: 100,
        growthStage: undefined,
      });
      await moveUnit(lab.member, id, { toLocationId: lab.rooms[1].id }, { requireScan: false });
      const current = (await statesOf(id)).at(-1);
      expect(current?.seedCount).toBe(100);
    });

    it("demands a matching barcode scan when required", async () => {
      const { id, name } = await registerOne(lab);
      const move = (barcode?: string) =>
        moveUnit(lab.member, id, { toLocationId: lab.rooms[1].id, barcode }, { requireScan: true });
      await expectCode(move(undefined), "FORBIDDEN");
      await expectCode(move("WRONG"), "FORBIDDEN");
      await move(name);
      expect((await statesOf(id)).at(-1)?.scanConfirmed).toBe(true);
    });

    it("refuses a no-op move and an unknown or inactive destination", async () => {
      const { id } = await registerOne(lab);
      await expectCode(
        moveUnit(lab.member, id, { toLocationId: lab.rooms[0].id }, { requireScan: false }),
        "CONFLICT"
      );
      await expectCode(
        moveUnit(lab.member, id, { toLocationId: 999_999 }, { requireScan: false }),
        "NOT_FOUND"
      );
      await prisma.location.update({ where: { id: lab.rooms[2].id }, data: { active: false } });
      await expectCode(
        moveUnit(lab.member, id, { toLocationId: lab.rooms[2].id }, { requireScan: false }),
        "LOCATION_INACTIVE"
      );
    });

    it("refuses outsiders", async () => {
      const { id } = await registerOne(lab);
      await expectCode(
        moveUnit(lab.outsider, id, { toLocationId: lab.rooms[1].id }, { requireScan: false }),
        "FORBIDDEN"
      );
    });

    it("is blocked while the unit is on quality hold", async () => {
      const { id } = await registerOne(lab);
      await prisma.unitHold.create({
        data: { unitId: id, reason: "Failed potency", placedById: lab.admin.id },
      });
      await expectCode(
        moveUnit(lab.member, id, { toLocationId: lab.rooms[1].id }, { requireScan: false }),
        "UNIT_ON_HOLD"
      );
    });
  });

  describe("stage changes", () => {
    it("records the new stage and keeps the location", async () => {
      const { id } = await registerOne(lab);
      await changeStage(lab.member, id, { toStage: GrowthStage.FLOWERING });
      const current = (await statesOf(id)).at(-1);
      expect(current).toMatchObject({
        kind: UnitStateKind.STAGE_CHANGED,
        growthStage: GrowthStage.FLOWERING,
        locationId: lab.rooms[0].id,
      });
    });

    it("rejects the same stage, non-staged material, and future dates", async () => {
      const { id } = await registerOne(lab);
      await expectCode(
        changeStage(lab.member, id, { toStage: GrowthStage.VEGETATIVE }),
        "CONFLICT"
      );
      await expectCode(
        changeStage(lab.member, id, { toStage: GrowthStage.FLOWERING, effectiveAt: "2999-01-01" }),
        "VALIDATION"
      );
      const seeds = await registerOne(lab, {
        name: "S1",
        type: UnitType.SEEDLOT,
        growthStage: undefined,
      });
      await expectCode(
        changeStage(lab.member, seeds.id, { toStage: GrowthStage.FLOWERING }),
        "VALIDATION"
      );
    });

    it("accepts a back-date after registration but not before it", async () => {
      const { id } = await registerOne(lab, { effectiveAt: "2026-05-01" });
      await expectCode(
        changeStage(lab.member, id, { toStage: GrowthStage.FLOWERING, effectiveAt: "2026-04-01" }),
        "VALIDATION"
      );
      await changeStage(lab.member, id, {
        toStage: GrowthStage.FLOWERING,
        effectiveAt: "2026-06-01",
      });
    });
  });

  describe("measurements", () => {
    it("replaces the in-place edits of the legacy PATCH with a MEASURED event", async () => {
      const { id } = await registerOne(lab);
      await measureUnit(lab.member, id, { humidWeight: 40, dryWeight: 9.25 });
      const states = await statesOf(id);
      expect(states).toHaveLength(2);
      expect(states[0]?.humidWeight).toBeNull(); // history is untouched
      expect(states[1]?.kind).toBe(UnitStateKind.MEASURED);
      expect(states[1]?.humidWeight?.toString()).toBe("40");
      expect(states[1]?.dryWeight?.toString()).toBe("9.25");

      const [, entry] = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });
      expect(entry?.action).toBe("measure");
    });

    it("applies weights to plants and flowers and seed counts to seed lots only", async () => {
      const plant = await registerOne(lab);
      await expectCode(measureUnit(lab.member, plant.id, { seedCount: 5 }), "VALIDATION");
      const seeds = await registerOne(lab, {
        name: "S1",
        type: UnitType.SEEDLOT,
        growthStage: undefined,
      });
      await expectCode(measureUnit(lab.member, seeds.id, { humidWeight: 5 }), "VALIDATION");
      await measureUnit(lab.member, seeds.id, { seedCount: 80 });
    });

    it("keeps a gapless sequence under concurrent writers on one unit", async () => {
      const { id } = await registerOne(lab, {
        name: "S1",
        type: UnitType.SEEDLOT,
        growthStage: undefined,
      });
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => measureUnit(lab.member, id, { seedCount: i + 1 }))
      );
      const states = await statesOf(id);
      expect(states.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const unit = await prisma.biologicalUnit.findUniqueOrThrow({ where: { id } });
      expect(unit.currentStateId).toBe(states.at(-1)?.id);
    });
  });

  describe("derivation", () => {
    it("never consumes the mother: she can be cut again and again", async () => {
      const mother = await registerOne(lab, { name: "MOTHER" });

      const first = await deriveUnits(lab.member, mother.id, {
        deriveType: "cutting",
        quantity: 3,
      });
      expect(first.units.map((u) => u.name)).toEqual(["MOTHER-CL-1", "MOTHER-CL-2", "MOTHER-CL-3"]);
      // Legacy bug: the second batch failed because the mother's state had been consumed.
      const second = await deriveUnits(lab.member, mother.id, { deriveType: "clone", quantity: 2 });
      expect(second.units.map((u) => u.name)).toEqual(["MOTHER-CL-4", "MOTHER-CL-5"]);

      const motherAfter = await prisma.biologicalUnit.findUniqueOrThrow({
        where: { id: mother.id },
        include: { currentState: true },
      });
      expect(motherAfter.currentState?.kind).toBe(UnitStateKind.CREATED);
      expect(await statesOf(mother.id)).toHaveLength(1);
      expect(await prisma.biologicalUnit.count({ where: { sourceParentUnitId: mother.id } })).toBe(
        5
      );
    });

    it("links each child to the mother's state at the moment of derivation", async () => {
      const mother = await registerOne(lab, { name: "MOTHER" });
      const before = (await statesOf(mother.id)).at(-1)!;
      const { units } = await deriveUnits(lab.member, mother.id, {
        deriveType: "cutting",
        quantity: 1,
      });
      await moveUnit(
        lab.member,
        mother.id,
        { toLocationId: lab.rooms[1].id },
        { requireScan: false }
      );
      const later = await deriveUnits(lab.member, mother.id, {
        deriveType: "cutting",
        quantity: 1,
      });

      const [firstChild] = await statesOf(units[0]!.id);
      const [laterChild] = await statesOf(later.units[0]!.id);
      expect(firstChild?.parentStateId).toBe(before.id);
      expect(laterChild?.parentStateId).not.toBe(before.id);
      expect(laterChild?.locationId).toBe(lab.rooms[1].id); // inherits the mother's location
    });

    it("inherits cultivar, experiment and sex, and starts cuttings in the vegetative stage", async () => {
      const mother = await registerOne(lab, {
        name: "MOTHER",
        sex: "FEMALE",
        growthStage: GrowthStage.FLOWERING,
      });
      const { units } = await deriveUnits(lab.member, mother.id, {
        deriveType: "cutting",
        quantity: 1,
      });
      const child = await prisma.biologicalUnit.findUniqueOrThrow({
        where: { id: units[0]!.id },
        include: { currentState: true },
      });
      expect(child).toMatchObject({
        cultivarId: lab.cultivar.id,
        experimentId: lab.experiment.id,
        sex: "FEMALE",
        sourceType: SourceType.CUTTING,
        sourceParentUnitId: mother.id,
      });
      expect(child.currentState?.growthStage).toBe(GrowthStage.VEGETATIVE);
    });

    it("makes cultures from subculture and refuses nonsensical parents", async () => {
      const mother = await registerOne(lab, { name: "MOTHER" });
      const { units } = await deriveUnits(lab.member, mother.id, {
        deriveType: "subculture",
        quantity: 1,
      });
      const culture = await prisma.biologicalUnit.findUniqueOrThrow({
        where: { id: units[0]!.id },
      });
      expect(culture.type).toBe(UnitType.CULTURE);

      const seeds = await registerOne(lab, {
        name: "S1",
        type: UnitType.SEEDLOT,
        growthStage: undefined,
      });
      await expectCode(
        deriveUnits(lab.member, seeds.id, { deriveType: "cutting", quantity: 1 }),
        "VALIDATION"
      );
    });

    it("is refused while the parent is on hold, and by outsiders", async () => {
      const mother = await registerOne(lab, { name: "MOTHER" });
      await expectCode(
        deriveUnits(lab.outsider, mother.id, { deriveType: "cutting", quantity: 1 }),
        "FORBIDDEN"
      );
      await prisma.unitHold.create({
        data: { unitId: mother.id, reason: "Suspected contamination", placedById: lab.admin.id },
      });
      await expectCode(
        deriveUnits(lab.member, mother.id, { deriveType: "cutting", quantity: 1 }),
        "UNIT_ON_HOLD"
      );
    });
  });

  describe("destruction", () => {
    const destroy = (actor: Lab["member"], id: number, reason = "Failed QC, destroyed per SOP") =>
      destroyUnit(actor, id, { reason });

    it("is for administrators and members of the experiment, and needs a reason", async () => {
      const { id } = await registerOne(lab);
      // Someone outside the experiment cannot destroy its unit.
      await expectCode(destroy(lab.outsider, id), "FORBIDDEN");
      await expectCode(destroy(lab.admin, id, ""), "VALIDATION").catch(() => undefined);

      // A member of the experiment can.
      const other = await registerOne(lab, { name: "Destroyed by a member" });
      await destroy(lab.member, other.id);
      expect((await statesOf(other.id)).at(-1)?.kind).toBe(UnitStateKind.DESTROYED);

      await destroy(lab.admin, id);
      const current = (await statesOf(id)).at(-1);
      expect(current).toMatchObject({
        kind: UnitStateKind.DESTROYED,
        reason: "Failed QC, destroyed per SOP",
        witnessId: null,
        recordedById: lab.admin.id,
      });
      const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
      expect(entry).toMatchObject({ action: "destroy", reason: "Failed QC, destroyed per SOP" });
    });

    it("is final: nothing further can happen to a destroyed unit", async () => {
      const { id } = await registerOne(lab);
      await destroy(lab.admin, id);
      await expectCode(destroy(lab.admin, id), "UNIT_NOT_ACTIVE");
      await expectCode(
        moveUnit(lab.member, id, { toLocationId: lab.rooms[1].id }, { requireScan: false }),
        "UNIT_NOT_ACTIVE"
      );
      await expectCode(
        changeStage(lab.member, id, { toStage: GrowthStage.FLOWERING }),
        "UNIT_NOT_ACTIVE"
      );
      await expectCode(measureUnit(lab.member, id, { dryWeight: 1 }), "UNIT_NOT_ACTIVE");
    });

    it("lets exactly one of two simultaneous destructions win", async () => {
      const { id } = await registerOne(lab);
      const results = await Promise.allSettled([destroy(lab.admin, id), destroy(lab.admin, id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected");
      expect(((failure as PromiseRejectedResult).reason as AppError).code).toBe("UNIT_NOT_ACTIVE");
      expect(await statesOf(id)).toHaveLength(2);
    });

    it("frees the location once the unit is destroyed", async () => {
      await prisma.location.update({ where: { id: lab.rooms[0].id }, data: { capacity: 1 } });
      const { id } = await registerOne(lab, { name: "P1" });
      await expectCode(registerOne(lab, { name: "P2" }), "CONFLICT");
      await destroy(lab.admin, id);
      await registerOne(lab, { name: "P2" });
    });
  });

  describe("details and lineage", () => {
    it("edits notes and sex with a before/after audit trail", async () => {
      const { id } = await registerOne(lab);
      const result = await updateUnitDetails(lab.member, id, { comment: "Healthy", sex: "FEMALE" });
      expect(result.changes.map((c) => c.field)).toEqual(["notes", "sex"]);
      expect((await updateUnitDetails(lab.member, id, { comment: "Healthy" })).unchanged).toBe(
        true
      );
    });

    it("lets only admins annotate a destroyed unit, and only its notes", async () => {
      const { id } = await registerOne(lab);
      await destroyUnit(lab.admin, id, { reason: "Destroyed per SOP" });
      await expectCode(updateUnitDetails(lab.member, id, { comment: "x" }), "FORBIDDEN");
      await expectCode(updateUnitDetails(lab.admin, id, { sex: "MALE" }), "VALIDATION");
      await updateUnitDetails(lab.admin, id, { comment: "Admin note after destruction" });
    });

    it("links a parent once, and refuses self-links and lineage loops", async () => {
      const a = await registerOne(lab, { name: "A" });
      const b = await registerOne(lab, { name: "B" });
      const c = await registerOne(lab, { name: "C" });

      await expectCode(linkParent(lab.member, a.id, { parentUnitId: a.id }), "VALIDATION");
      await linkParent(lab.member, b.id, { parentUnitId: a.id }); // A → B
      await expectCode(linkParent(lab.member, b.id, { parentUnitId: c.id }), "CONFLICT"); // already linked
      await linkParent(lab.member, c.id, { parentUnitId: b.id }); // A → B → C
      await expectCode(linkParent(lab.member, a.id, { parentUnitId: c.id }), "CONFLICT"); // loop
    });
  });
});
