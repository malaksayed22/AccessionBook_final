import { beforeEach, describe, expect, it } from "vitest";
import { SourceType, UnitStateKind, UnitType } from "@/generated/prisma/enums";
import { zonedDateKey } from "@/lib/lab-time";
import {
  addExperimentMember,
  completeExperiment,
  createExperiment,
  deriveIntoNewExperiment,
  removeExperimentMember,
  reopenExperiment,
  updateExperiment,
} from "@/features/experiment/service";
import {
  readExperimentDocument,
  uploadExperimentDocument,
  voidExperimentDocument,
} from "@/features/experiment/documents";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, resetDatabase, statesOf, verifyChain } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

process.env.LAB_TIMEZONE = "America/Toronto";

const base = { name: "Trial", startDate: "2026-01-10", providerMode: "INTERNAL" as const };

describe("experiment service", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const group = (over: Record<string, unknown> = {}) => ({
    kind: "CLONES",
    cultivarId: lab.cultivar.id,
    cultivarMode: "SAME" as const,
    quantity: 3,
    statusMode: "SAME" as const,
    status: "VEGETATIVE",
    ...over,
  });

  const intake = (over: Record<string, unknown> = {}) =>
    ({
      ...base,
      locationId: lab.rooms[0].id,
      providerMode: "INTERNAL",
      sourceDescription: "Internal stock for the trial",
      unitGroups: [group()],
      ...over,
    }) as Parameters<typeof createExperiment>[1];

  it("creates a running experiment with its lead and sequential codes from one system-wide prefix", async () => {
    const first = await createExperiment(lab.member, base);
    const second = await createExperiment(lab.admin, base);
    expect([first.ecode, second.ecode]).toEqual(["EXP1", "EXP2"]);

    const members = await prisma.experimentMember.findMany({ where: { experimentId: first.id } });
    expect(members).toMatchObject([{ userId: lab.member.id, role: "LEAD" }]);
    // No end date at creation: the experiment is running until it is completed.
    expect(
      (await prisma.experiment.findUniqueOrThrow({ where: { id: first.id } })).endDate
    ).toBeNull();
  });

  it("gives simultaneous creators different codes", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createExperiment(lab.member, { ...base, name: `Parallel ${i}` })
      )
    );
    expect(new Set(results.map((r) => r.ecode)).size).toBe(6);
    expect(await verifyChain()).toEqual([]);
  });

  it("registers intake units with codes, cultivar and location in the same transaction", async () => {
    const result = await createExperiment(lab.member, intake());
    expect(result.units.map((u) => u.name)).toEqual(["EXP1-001", "EXP1-002", "EXP1-003"]);

    const units = await prisma.biologicalUnit.findMany({
      where: { experimentId: result.id },
      include: { currentState: true },
      orderBy: { name: "asc" },
    });
    expect(units).toHaveLength(3);
    for (const unit of units) {
      expect(unit).toMatchObject({
        type: UnitType.PLANT,
        sourceType: SourceType.INTERNAL,
        cultivarId: lab.cultivar.id,
      });
      expect(unit.currentState).toMatchObject({
        kind: UnitStateKind.CREATED,
        locationId: lab.rooms[0].id,
        growthStage: "VEGETATIVE",
      });
    }
  });

  it("books external intake as RECEIVED with an inbound receipt linked to each unit's state", async () => {
    const result = await createExperiment(
      lab.member,
      intake({
        providerMode: "EXTERNAL",
        providerOrganizationId: lab.provider.id,
        sourceDescription: undefined,
        unitGroups: [group({ quantity: 2 })],
      })
    );
    expect(result.receipt?.reference).toMatch(/^RCV-/);

    const states = await prisma.unitState.findMany({
      where: { unit: { experimentId: result.id } },
    });
    expect(states.every((s) => s.kind === UnitStateKind.RECEIVED)).toBe(true);
    expect(states.every((s) => s.organizationId === lab.provider.id)).toBe(true);

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { id: result.receipt!.id },
      include: { items: true },
    });
    expect(shipment).toMatchObject({
      direction: "INBOUND",
      status: "DELIVERED",
    });
    expect(shipment.items).toHaveLength(2);
    expect(new Set(shipment.items.map((i) => i.stateId))).toEqual(new Set(states.map((s) => s.id)));
  });

  it("refuses an over-capacity intake and creates nothing, unless explicitly overridden", async () => {
    await prisma.location.update({ where: { id: lab.rooms[0].id }, data: { capacity: 2 } });
    await expectCode(createExperiment(lab.member, intake()), "CONFLICT");
    expect(await prisma.experiment.count()).toBe(1); // only the fixture experiment
    expect(await prisma.biologicalUnit.count()).toBe(0);

    const result = await createExperiment(lab.member, intake({ ignoreCapacityWarning: true }));
    expect(result.units).toHaveLength(3);
    const entry = (await prisma.auditLog.findMany({ where: { entityType: "experiment" } }))[0];
    expect(entry?.summary).toMatch(/capacity override/);
  });

  it("dates intake units no later than now, even for an experiment that starts in the future", async () => {
    const result = await createExperiment(lab.member, intake({ startDate: "2999-01-01" }));
    const [state] = await statesOf(result.units[0]!.unitId);
    expect(state!.effectiveAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("validates the start date, the supplier and cultivars", async () => {
    await expectCode(
      createExperiment(lab.member, { ...base, startDate: "not a date" }),
      "VALIDATION"
    );
    // The material source is always required: an external source needs its supplier, units or not.
    await expectCode(
      createExperiment(lab.member, { ...base, providerMode: "EXTERNAL" }),
      "VALIDATION"
    );
    await expectCode(
      createExperiment(lab.member, intake({ unitGroups: [group({ cultivarId: 999_999 })] })),
      "VALIDATION"
    );
    expect(await prisma.experiment.count()).toBe(1); // only the fixture experiment
  });

  it("honours extra members only for admins", async () => {
    const byMember = await createExperiment(lab.member, {
      ...base,
      memberIds: [lab.outsider.id],
    });
    expect(await prisma.experimentMember.count({ where: { experimentId: byMember.id } })).toBe(1);

    const byAdmin = await createExperiment(lab.admin, {
      ...base,
      memberIds: [lab.outsider.id, lab.witness.id],
    });
    expect(await prisma.experimentMember.count({ where: { experimentId: byAdmin.id } })).toBe(3);
  });

  it("requires membership of the parent experiment for a sub-experiment", async () => {
    await expectCode(
      createExperiment(lab.outsider, { ...base, parentExperimentId: lab.experiment.id }),
      "FORBIDDEN"
    );
    await createExperiment(lab.member, { ...base, parentExperimentId: lab.experiment.id });
  });

  it("keeps an optional estimated end date, never before the start", async () => {
    const withEstimate = await createExperiment(lab.member, {
      ...base,
      estimatedEndDate: "2026-09-30",
    });
    const row = await prisma.experiment.findUniqueOrThrow({ where: { id: withEstimate.id } });
    expect(row.estimatedEndDate?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(row.endDate).toBeNull(); // an estimate does not complete anything
    await expectCode(
      createExperiment(lab.member, { ...base, estimatedEndDate: "2025-12-31" }),
      "VALIDATION"
    );
  });

  it("derives into a new sub-experiment in one transaction, and creates nothing if refused", async () => {
    const parent = await createExperiment(
      lab.member,
      intake({ unitGroups: [group({ quantity: 1, kind: "PLANTS" })] })
    );
    const mother = await prisma.biologicalUnit.findFirstOrThrow({
      where: { experimentId: parent.id },
    });

    const result = await deriveIntoNewExperiment(lab.member, mother.id, {
      deriveType: "clone",
      quantity: 2,
      newExperiment: { name: "Clones in their own trial" },
    });
    const created = await prisma.experiment.findUniqueOrThrow({
      where: { id: result.experiment.id },
      include: { members: true },
    });
    expect(created).toMatchObject({
      name: "Clones in their own trial",
      parentExperimentId: parent.id,
      sourceUnitId: mother.id,
      endDate: null,
    });
    expect(created.members).toMatchObject([{ userId: lab.member.id, role: "LEAD" }]);
    const clones = await prisma.biologicalUnit.findMany({ where: { experimentId: created.id } });
    expect(clones).toHaveLength(2);
    // The parent stays where it was.
    expect(
      (await prisma.biologicalUnit.findUniqueOrThrow({ where: { id: mother.id } })).experimentId
    ).toBe(parent.id);

    // A refused derivation (a hold) leaves no experiment behind.
    await prisma.unitHold.create({
      data: {
        unitId: mother.id,
        kind: "HOLD",
        reason: "Checking",
        origin: "MANUAL",
        placedById: lab.admin.id,
      },
    });
    const before = await prisma.experiment.count();
    await expectCode(
      deriveIntoNewExperiment(lab.member, mother.id, {
        deriveType: "clone",
        quantity: 1,
        newExperiment: { name: "Never created" },
      }),
      "UNIT_ON_HOLD"
    );
    expect(await prisma.experiment.count()).toBe(before);
  });

  it("lets an internal source go undescribed", async () => {
    const result = await createExperiment(lab.member, intake({ sourceDescription: undefined }));
    expect(result.units).toHaveLength(3);
  });

  it("starts with no units when none are asked for, whatever the source", async () => {
    const result = await createExperiment(lab.member, base);
    expect(result.units).toEqual([]);
    expect(result.receipt).toBeNull();
  });

  describe("completing", () => {
    const experimentId = () => lab.experiment.id;
    const endDate = async () =>
      (await prisma.experiment.findUniqueOrThrow({ where: { id: experimentId() } })).endDate;

    it("sets the end date to the day it was completed, for members and admins only", async () => {
      await expectCode(completeExperiment(lab.outsider, experimentId(), {}), "FORBIDDEN");
      expect(await endDate()).toBeNull();

      await completeExperiment(lab.member, experimentId(), { endDate: "2026-02-01" });
      expect((await endDate())?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
      await expectCode(completeExperiment(lab.member, experimentId(), {}), "CONFLICT");
      const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
      expect(entry?.details).toEqual([{ field: "status", from: "running", to: "completed" }]);
    });

    it("completes today when no date is given, and refuses impossible dates", async () => {
      await expectCode(
        completeExperiment(lab.member, experimentId(), { endDate: "2025-12-31" }),
        "VALIDATION"
      );
      await expectCode(
        completeExperiment(lab.member, experimentId(), { endDate: "2999-01-01" }),
        "VALIDATION"
      );
      await completeExperiment(lab.member, experimentId(), {});
      // "Today" is the laboratory's day, stored like every experiment day: midnight UTC of the date.
      expect(await endDate()).toEqual(
        new Date(
          `${zonedDateKey(new Date(), process.env.LAB_TIMEZONE ?? "America/Toronto")}T00:00:00Z`
        )
      );
    });

    it("is reopened by administrators only", async () => {
      await completeExperiment(lab.member, experimentId(), { endDate: "2026-02-01" });
      await expectCode(reopenExperiment(lab.member, experimentId()), "FORBIDDEN");
      await reopenExperiment(lab.admin, experimentId());
      expect(await endDate()).toBeNull();
      await expectCode(reopenExperiment(lab.admin, experimentId()), "CONFLICT");
    });
  });

  describe("documents", () => {
    const file = { fileName: "protocol.txt", bytes: Buffer.from("Spray at dawn.\n") };

    it("lets members attach a document, whoever may read the experiment download it, and voids it with a reason", async () => {
      await expectCode(
        uploadExperimentDocument(lab.outsider, lab.experiment.id, file),
        "FORBIDDEN"
      );
      const { documentId } = await uploadExperimentDocument(lab.member, lab.experiment.id, {
        ...file,
        label: "Protocol v1",
      });
      const row = await prisma.experimentAttachment.findUniqueOrThrow({
        where: { id: documentId },
      });
      expect(row).toMatchObject({ label: "Protocol v1", userId: lab.member.id });
      expect(row.mimeType).toMatch(/^text\/plain/);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

      const read = await readExperimentDocument(lab.member, lab.experiment.id, documentId);
      expect(read.body.toString()).toBe("Spray at dawn.\n");
      // A member outside the experiment cannot read it; an administrator can.
      await expectCode(
        readExperimentDocument(lab.outsider, lab.experiment.id, documentId),
        "NOT_FOUND"
      );
      await readExperimentDocument(lab.admin, lab.experiment.id, documentId);

      await expectCode(
        voidExperimentDocument(lab.outsider, lab.experiment.id, documentId, { reason: "Not mine" }),
        "FORBIDDEN"
      );
      await voidExperimentDocument(lab.member, lab.experiment.id, documentId, {
        reason: "Superseded by v2",
      });
      await expectCode(
        readExperimentDocument(lab.admin, lab.experiment.id, documentId),
        "NOT_FOUND"
      );
    });

    it("rejects files that are not on the allow-list", async () => {
      await expectCode(
        uploadExperimentDocument(lab.member, lab.experiment.id, {
          fileName: "page.html",
          bytes: Buffer.from("<script>alert(1)</script>"),
        }),
        "VALIDATION"
      );
    });
  });

  describe("administrators correcting the record", () => {
    const row = () => prisma.experiment.findUniqueOrThrow({ where: { id: lab.experiment.id } });

    it("lets members change the estimate but not the start or completion day", async () => {
      await updateExperiment(lab.member, lab.experiment.id, { estimatedEndDate: "2026-12-01" });
      expect((await row()).estimatedEndDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
      await updateExperiment(lab.member, lab.experiment.id, { estimatedEndDate: "" });
      expect((await row()).estimatedEndDate).toBeNull();
      await expectCode(
        updateExperiment(lab.member, lab.experiment.id, { startDate: "2026-01-05" }),
        "FORBIDDEN"
      );
      await expectCode(
        updateExperiment(lab.member, lab.experiment.id, { endDate: "2026-02-01" }),
        "FORBIDDEN"
      );
    });

    it("lets an administrator correct the start day and a completed experiment's end day", async () => {
      await expectCode(
        updateExperiment(lab.admin, lab.experiment.id, { endDate: "2026-02-01" }),
        "VALIDATION" // still running: complete it first
      );
      await completeExperiment(lab.member, lab.experiment.id, { endDate: "2026-02-01" });
      await updateExperiment(lab.admin, lab.experiment.id, {
        startDate: "2026-01-10",
        endDate: "2026-03-15",
      });
      const done = await row();
      expect(done.startDate.toISOString()).toBe("2026-01-10T00:00:00.000Z");
      expect(done.endDate?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
      expect(entry?.details).toEqual([
        { field: "start date", from: "2026-01-01", to: "2026-01-10" },
        { field: "completion date", from: "2026-02-01", to: "2026-03-15" },
      ]);
    });

    it("refuses impossible corrections", async () => {
      await completeExperiment(lab.member, lab.experiment.id, { endDate: "2026-02-01" });
      await expectCode(
        updateExperiment(lab.admin, lab.experiment.id, { endDate: "2025-12-01" }),
        "VALIDATION"
      );
      await expectCode(
        updateExperiment(lab.admin, lab.experiment.id, { endDate: "2999-01-01" }),
        "VALIDATION"
      );
      await expectCode(
        updateExperiment(lab.admin, lab.experiment.id, { startDate: "2026-03-01" }),
        "VALIDATION" // after the completion day
      );
    });
  });

  describe("membership and edits", () => {
    it("lets only admins assign and remove members, and never the lead", async () => {
      await expectCode(
        addExperimentMember(lab.member, lab.experiment.id, lab.outsider.id),
        "FORBIDDEN"
      );
      expect((await addExperimentMember(lab.admin, lab.experiment.id, lab.outsider.id)).added).toBe(
        true
      );
      expect((await addExperimentMember(lab.admin, lab.experiment.id, lab.outsider.id)).added).toBe(
        false
      );
      await expectCode(addExperimentMember(lab.admin, lab.experiment.id, 999_999), "VALIDATION");

      await removeExperimentMember(lab.admin, lab.experiment.id, lab.outsider.id);
      await expectCode(
        removeExperimentMember(lab.admin, lab.experiment.id, lab.member.id),
        "CONFLICT"
      );
      await expectCode(
        removeExperimentMember(lab.member, lab.experiment.id, lab.outsider.id),
        "FORBIDDEN"
      );
    });

    it("lets members edit, outsiders not, and records before/after", async () => {
      await expectCode(
        updateExperiment(lab.outsider, lab.experiment.id, { name: "Hijacked" }),
        "FORBIDDEN"
      );
      expect(
        (await updateExperiment(lab.member, lab.experiment.id, { name: "Renamed" })).unchanged
      ).toBe(false);
      expect(
        (await updateExperiment(lab.member, lab.experiment.id, { name: "Renamed" })).unchanged
      ).toBe(true);
      const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
      expect(entry?.details).toEqual([{ field: "name", from: "Test experiment", to: "Renamed" }]);
    });
  });
});
