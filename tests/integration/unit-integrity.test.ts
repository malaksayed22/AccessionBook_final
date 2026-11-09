import { beforeEach, describe, expect, it } from "vitest";
import { UnitStateKind, UnitType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase, statesOf } from "./helpers";

/**
 * These tests bypass the services on purpose. They prove the database itself refuses to let the
 * state chain be corrupted, so a future bug in application code cannot damage regulated records.
 */
describe("state chain integrity (database level)", () => {
  let lab: Awaited<ReturnType<typeof createLab>>;
  let unitId: number;

  const insertState = (
    overrides: Partial<{
      sequence: number;
      kind: UnitStateKind;
      reason: string | null;
      witnessId: number;
    }> = {},
    forUnit = unitId
  ) =>
    prisma.unitState.create({
      data: {
        unitId: forUnit,
        sequence: 2,
        kind: UnitStateKind.MOVED,
        effectiveAt: new Date(),
        recordedById: lab.member.id,
        ...overrides,
      },
    });

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    unitId = (await registerOne(lab)).id;
  });

  it("refuses to rewrite or delete a state", async () => {
    const [state] = await statesOf(unitId);
    await expect(
      prisma.unitState.update({ where: { id: state!.id }, data: { comment: "edited" } })
    ).rejects.toThrow(/append-only/);
    await expect(prisma.unitState.delete({ where: { id: state!.id } })).rejects.toThrow(
      /append-only/
    );
    await expect(prisma.unitState.deleteMany()).rejects.toThrow(/append-only/);
  });

  it("requires sequence numbers to be contiguous", async () => {
    await expect(insertState({ sequence: 3 })).rejects.toThrow(/sequence/i);
    await expect(insertState({ sequence: 1 })).rejects.toThrow(); // duplicate
    await insertState({ sequence: 2 });
  });

  it("requires a unit's first event to be CREATED or RECEIVED", async () => {
    const empty = await prisma.biologicalUnit.create({
      data: { name: "EMPTY", type: UnitType.PLANT },
    });
    await expect(insertState({ sequence: 1, kind: UnitStateKind.MOVED }, empty.id)).rejects.toThrow(
      /first event/i
    );
    await insertState({ sequence: 1, kind: UnitStateKind.CREATED }, empty.id);
  });

  it("accepts nothing after a terminal event", async () => {
    await insertState({ sequence: 2, kind: UnitStateKind.DESTROYED, reason: "Destroyed per SOP" });
    await expect(insertState({ sequence: 3 })).rejects.toThrow(/left inventory/);

    const shippedUnit = (await registerOne(lab, { name: "P2" })).id;
    await insertState({ sequence: 2, kind: UnitStateKind.SHIPPED }, shippedUnit);
    await expect(insertState({ sequence: 3 }, shippedUnit)).rejects.toThrow(/left inventory/);
  });

  it("requires a reason for destruction and a witness other than the actor", async () => {
    await expect(insertState({ kind: UnitStateKind.DESTROYED, reason: null })).rejects.toThrow();
    await expect(insertState({ kind: UnitStateKind.DESTROYED, reason: "   " })).rejects.toThrow();
    await expect(
      insertState({ kind: UnitStateKind.DESTROYED, reason: "SOP", witnessId: lab.member.id })
    ).rejects.toThrow();
  });

  it("only lets the unit point at its own newest state", async () => {
    const other = (await registerOne(lab, { name: "OTHER" })).id;
    const [otherState] = await statesOf(other);
    await expect(
      prisma.biologicalUnit.update({
        where: { id: unitId },
        data: { currentStateId: otherState!.id },
      })
    ).rejects.toThrow(/newest state/);

    const second = await insertState({ sequence: 2 });
    const [first] = await statesOf(unitId);
    await expect(
      prisma.biologicalUnit.update({ where: { id: unitId }, data: { currentStateId: first!.id } })
    ).rejects.toThrow(/newest state/);
    await prisma.biologicalUnit.update({
      where: { id: unitId },
      data: { currentStateId: second.id },
    });
  });

  it("rejects negative weights and counts", async () => {
    await expect(insertState({ sequence: 2 }).then(() => null)).resolves.toBeNull();
    await expect(
      prisma.unitState.create({
        data: {
          unitId,
          sequence: 3,
          kind: UnitStateKind.MEASURED,
          effectiveAt: new Date(),
          recordedById: lab.member.id,
          dryWeight: -1,
        },
      })
    ).rejects.toThrow();
  });

  describe("holds", () => {
    it("allows one active hold per unit at a time", async () => {
      await prisma.unitHold.create({ data: { unitId, reason: "First", placedById: lab.admin.id } });
      await expect(
        prisma.unitHold.create({ data: { unitId, reason: "Second", placedById: lab.admin.id } })
      ).rejects.toThrow();
    });

    it("treats a released hold as history", async () => {
      const hold = await prisma.unitHold.create({
        data: { unitId, reason: "Failed potency", placedById: lab.admin.id },
      });
      await expect(
        prisma.unitHold.update({ where: { id: hold.id }, data: { reason: "Rewritten" } })
      ).rejects.toThrow(/release fields/);
      await expect(
        prisma.unitHold.update({ where: { id: hold.id }, data: { releasedAt: new Date() } })
      ).rejects.toThrow(); // a release needs a releasing member

      await prisma.unitHold.update({
        where: { id: hold.id },
        data: { releasedAt: new Date(), releasedById: lab.admin.id, releaseNote: "Retest passed" },
      });
      await expect(
        prisma.unitHold.update({ where: { id: hold.id }, data: { releaseNote: "changed" } })
      ).rejects.toThrow(/history/);
      await expect(prisma.unitHold.delete({ where: { id: hold.id } })).rejects.toThrow(
        /never deleted/
      );

      // With the first hold released, a new one can be placed.
      await prisma.unitHold.create({ data: { unitId, reason: "Again", placedById: lab.admin.id } });
    });
  });

  describe("regulated records are never deleted", () => {
    it("protects lab tests, incidents, attachments, activities and shipments", async () => {
      const test = await prisma.labTest.create({
        data: {
          unitId,
          userId: lab.member.id,
          panel: "POTENCY",
          analyte: "THC",
        },
      });
      await expect(prisma.labTest.delete({ where: { id: test.id } })).rejects.toThrow(
        /never deleted/
      );

      const incident = await prisma.qualityIncident.create({
        data: { title: "t", severity: "MINOR", description: "d", userId: lab.member.id },
      });
      await expect(prisma.qualityIncident.delete({ where: { id: incident.id } })).rejects.toThrow(
        /never deleted/
      );

      const attachment = await prisma.unitAttachment.create({
        data: {
          unitId,
          userId: lab.member.id,
          label: "photo",
          fileName: "p.png",
          filePath: "k",
          category: "PHOTO",
        },
      });
      await expect(prisma.unitAttachment.delete({ where: { id: attachment.id } })).rejects.toThrow(
        /never deleted/
      );

      const activity = await prisma.unitActivity.create({
        data: { unitId, userId: lab.member.id, type: "SCOUTING", title: "looked" },
      });
      await expect(prisma.unitActivity.delete({ where: { id: activity.id } })).rejects.toThrow(
        /never deleted/
      );

      const shipment = await prisma.shipment.create({
        data: {
          reference: "SHP-1",
          direction: "OUTBOUND",
          organizationId: lab.provider.id,
          userId: lab.admin.id,
        },
      });
      await expect(prisma.shipment.delete({ where: { id: shipment.id } })).rejects.toThrow(
        /never deleted/
      );
    });

    it("requires who and why to void a record", async () => {
      const test = await prisma.labTest.create({
        data: {
          unitId,
          userId: lab.member.id,
          panel: "POTENCY",
          analyte: "THC",
        },
      });
      await expect(
        prisma.labTest.update({ where: { id: test.id }, data: { voidedAt: new Date() } })
      ).rejects.toThrow();
      await prisma.labTest.update({
        where: { id: test.id },
        data: {
          voidedAt: new Date(),
          voidedById: lab.admin.id,
          voidReason: "Entered on the wrong unit",
        },
      });
    });
  });

  describe("experiment code counter", () => {
    it("hands out each number exactly once, even to simultaneous callers", async () => {
      const numbers = await Promise.all(
        Array.from({ length: 12 }, () =>
          prisma.$queryRaw<Array<{ n: number }>>`SELECT next_experiment_number('ZZ') AS n`.then(
            (r) => r[0]!.n
          )
        )
      );
      expect([...numbers].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1)
      );
    });
  });
});
