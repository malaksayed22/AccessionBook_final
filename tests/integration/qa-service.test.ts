import { beforeEach, describe, expect, it } from "vitest";
import {
  HoldKind,
  HoldOrigin,
  IncidentSeverity,
  IncidentStatus,
  TestPanel,
} from "@/generated/prisma/enums";
import {
  openIncident,
  placeHold,
  recordLabTest,
  releaseHold,
  updateIncident,
  voidIncident,
  voidLabTest,
} from "@/features/qa/service";
import { moveUnit } from "@/features/unit/service";
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

const potency = {
  panel: TestPanel.POTENCY,
  analyte: "THC",
  uom: "%",
};

describe("quality service", () => {
  let lab: Lab;
  let unitId: number;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    unitId = (await registerOne(lab)).id;
  });

  const activeHold = () => prisma.unitHold.findFirst({ where: { unitId, releasedAt: null } });

  describe("holds", () => {
    it("places a hold with a reason, who and when", async () => {
      await placeHold(lab.member, unitId, { reason: "Suspected mould", kind: HoldKind.HOLD });
      expect(await activeHold()).toMatchObject({
        reason: "Suspected mould",
        kind: HoldKind.HOLD,
        origin: HoldOrigin.MANUAL,
        placedById: lab.member.id,
      });
      const [, entry] = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });
      expect(entry).toMatchObject({ action: "hold", reason: "Suspected mould" });
    });

    it("blocks movement while held, and still allows tests and notes", async () => {
      await placeHold(lab.member, unitId, { reason: "Suspected mould", kind: HoldKind.HOLD });
      await expectCode(
        moveUnit(lab.member, unitId, { toLocationId: lab.rooms[1].id }, { requireScan: false }),
        "UNIT_ON_HOLD"
      );
      await recordLabTest(lab.member, unitId, { ...potency, value: 10 });
    });

    it("refuses a second hold on a unit already held", async () => {
      await placeHold(lab.member, unitId, { reason: "First hold", kind: HoldKind.HOLD });
      await expectCode(
        placeHold(lab.member, unitId, { reason: "Second hold", kind: HoldKind.HOLD }),
        "CONFLICT"
      );
    });

    it("lets only admins release, with a reason, and keeps the hold as history", async () => {
      await placeHold(lab.member, unitId, { reason: "Suspected mould", kind: HoldKind.HOLD });
      await expectCode(releaseHold(lab.member, unitId, { note: "Looks fine to me" }), "FORBIDDEN");

      await releaseHold(lab.admin, unitId, { note: "Retest passed, batch released" });
      expect(await activeHold()).toBeNull();
      const [released] = await prisma.unitHold.findMany({ where: { unitId } });
      expect(released).toMatchObject({
        releasedById: lab.admin.id,
        releaseNote: "Retest passed, batch released",
      });
      expect(released?.releasedAt).toBeInstanceOf(Date);

      await moveUnit(lab.member, unitId, { toLocationId: lab.rooms[1].id }, { requireScan: false });
      await expectCode(
        releaseHold(lab.admin, unitId, { note: "Again, nothing to release" }),
        "CONFLICT"
      );
    });

    it("refuses outsiders", async () => {
      await expectCode(
        placeHold(lab.outsider, unitId, { reason: "Because I can", kind: HoldKind.HOLD }),
        "FORBIDDEN"
      );
    });
  });

  describe("lab tests", () => {
    it("records a result as reported, and never holds the unit because of it", async () => {
      const { testId } = await recordLabTest(lab.member, unitId, { ...potency, value: 95 });
      expect(await prisma.labTest.findUniqueOrThrow({ where: { id: testId } })).toMatchObject({
        panel: TestPanel.POTENCY,
        analyte: "THC",
        value: 95,
        userId: lab.member.id,
      });
      expect(await activeHold()).toBeNull();
    });

    it("records the wet and dry weights with no analyte, and needs at least something to record", async () => {
      await expectCode(
        recordLabTest(lab.member, unitId, { panel: TestPanel.POTENCY }),
        "VALIDATION"
      );
      const { testId } = await recordLabTest(lab.member, unitId, {
        panel: TestPanel.POTENCY,
        wetWeight: 12.5,
        dryWeight: 3.1,
      });
      expect(await prisma.labTest.findUniqueOrThrow({ where: { id: testId } })).toMatchObject({
        analyte: null,
        uom: null,
        value: null,
        wetWeight: 12.5,
        dryWeight: 3.1,
      });
    });

    it("accepts a result described in the note when there is no number", async () => {
      const described = { panel: TestPanel.MICROBIALS, analyte: "Salmonella" };
      await expectCode(recordLabTest(lab.member, unitId, described), "VALIDATION");
      const ok = await recordLabTest(lab.member, unitId, {
        ...described,
        comment: "Not detected in 25 g",
        labName: "Acme Labs",
      });
      expect(await prisma.labTest.findUniqueOrThrow({ where: { id: ok.testId } })).toMatchObject({
        value: null,
        comment: "Not detected in 25 g",
      });
    });

    it("rejects future dates and outsiders", async () => {
      await expectCode(
        recordLabTest(lab.member, unitId, { ...potency, value: 5, testedAt: "2999-01-01" }),
        "VALIDATION"
      );
      await expectCode(recordLabTest(lab.outsider, unitId, { ...potency, value: 5 }), "FORBIDDEN");
    });

    it("voids with who and why; only the author or an admin may, and the record stays", async () => {
      const { testId } = await recordLabTest(lab.member, unitId, { ...potency, value: 5 });
      await expectCode(
        voidLabTest(lab.outsider, testId, { reason: "Not mine to void" }),
        "FORBIDDEN"
      );

      await voidLabTest(lab.member, testId, { reason: "Entered on the wrong unit" });
      const voided = await prisma.labTest.findUniqueOrThrow({ where: { id: testId } });
      expect(voided).toMatchObject({
        voidedById: lab.member.id,
        voidReason: "Entered on the wrong unit",
      });
      await expectCode(voidLabTest(lab.admin, testId, { reason: "Already voided" }), "NOT_FOUND");
    });
  });

  describe("incidents", () => {
    const incident = { title: "Pest outbreak", description: "Spider mites found in room 1" };

    it("holds the unit automatically for a CRITICAL incident, not for a MINOR one", async () => {
      const minor = await openIncident(lab.member, {
        ...incident,
        severity: IncidentSeverity.MINOR,
        unitId,
      });
      expect(minor.autoHeld).toBe(false);
      expect(await activeHold()).toBeNull();

      const critical = await openIncident(lab.member, {
        ...incident,
        severity: IncidentSeverity.CRITICAL,
        unitId,
      });
      expect(critical.autoHeld).toBe(true);
      expect(await activeHold()).toMatchObject({ origin: HoldOrigin.AUTO_INCIDENT });
    });

    it("authorises the unit and experiment it is linked to", async () => {
      await expectCode(
        openIncident(lab.outsider, { ...incident, severity: IncidentSeverity.MAJOR, unitId }),
        "FORBIDDEN"
      );
      await expectCode(
        openIncident(lab.outsider, {
          ...incident,
          severity: IncidentSeverity.MAJOR,
          experimentId: lab.experiment.id,
        }),
        "FORBIDDEN"
      );
      // Anyone may report a general problem that is not tied to a unit or experiment.
      await openIncident(lab.outsider, { ...incident, severity: IncidentSeverity.MINOR });
    });

    it("needs a resolution to close, and unlinked incidents are closed by admins only", async () => {
      const linked = await openIncident(lab.member, {
        ...incident,
        severity: IncidentSeverity.MAJOR,
        unitId,
      });
      await expectCode(
        updateIncident(lab.member, linked.incidentId, { status: IncidentStatus.CLOSED }),
        "VALIDATION"
      );
      await updateIncident(lab.member, linked.incidentId, {
        status: IncidentStatus.CLOSED,
        resolution: "Treated and verified",
      });
      const closed = await prisma.qualityIncident.findUniqueOrThrow({
        where: { id: linked.incidentId },
      });
      expect(closed.status).toBe(IncidentStatus.CLOSED);
      expect(closed.closedAt).toBeInstanceOf(Date);

      const general = await openIncident(lab.outsider, {
        ...incident,
        severity: IncidentSeverity.MINOR,
      });
      await expectCode(
        updateIncident(lab.outsider, general.incidentId, { status: IncidentStatus.INVESTIGATING }),
        "FORBIDDEN"
      );
      await updateIncident(lab.admin, general.incidentId, { status: IncidentStatus.INVESTIGATING });
    });

    it("is voided by admins with a reason", async () => {
      const { incidentId } = await openIncident(lab.member, {
        ...incident,
        severity: IncidentSeverity.MINOR,
      });
      await expectCode(
        voidIncident(lab.member, incidentId, { reason: "Duplicate entry" }),
        "FORBIDDEN"
      );
      await voidIncident(lab.admin, incidentId, { reason: "Duplicate entry" });
      expect(
        (await prisma.qualityIncident.findUniqueOrThrow({ where: { id: incidentId } })).voidedAt
      ).not.toBeNull();
    });
  });

  it("leaves a verifiable audit chain behind all of it", async () => {
    await placeHold(lab.member, unitId, { reason: "Suspected mould", kind: HoldKind.HOLD });
    await releaseHold(lab.admin, unitId, { note: "Retest passed, batch released" });
    await recordLabTest(lab.member, unitId, { ...potency, value: 25 });
    expect(await verifyChain()).toEqual([]);
  });
});
