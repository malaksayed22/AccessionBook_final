import { beforeEach, describe, expect, it } from "vitest";
import { runCapaCommand } from "@/features/qa/capa";
import { getIncidentDetail } from "@/features/qa/queries";
import { openIncident, updateIncident } from "@/features/qa/service";
import { AppError } from "@/server/errors";
import { prisma } from "@/server/db";
import { createLab, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("corrective and preventive actions", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("raises, completes and checks actions, and keeps the incident open until they are done", async () => {
    const { incidentId } = await openIncident(lab.admin, {
      title: "Scale out of tolerance",
      description: "The daily check read 1.04 g for the 1 g weight.",
      severity: "MAJOR",
    });

    // Only quality assurance raises an action.
    expect(
      (
        await failure(
          runCapaCommand(lab.member, incidentId, {
            action: "add",
            kind: "CORRECTIVE",
            description: "Recalibrate",
          })
        )
      ).code
    ).toBe("FORBIDDEN");
    const { capaId } = await runCapaCommand(lab.admin, incidentId, {
      action: "add",
      kind: "CORRECTIVE",
      description: "Recalibrate the scale",
      ownerId: lab.member.id,
      dueDate: "2026-11-20",
    });
    await runCapaCommand(lab.admin, incidentId, {
      action: "add",
      kind: "PREVENTIVE",
      description: "Add the daily check to SOP-004",
    });

    // While an action is still to be done, the incident stays open.
    const blocked = await failure(
      updateIncident(lab.admin, incidentId, { status: "CLOSED", resolution: "Recalibrated" })
    );
    expect(blocked.details).toMatchObject({ reason: "capaOpen", values: { count: 2 } });

    // The owner records it as done; someone else cannot; only QA checks it.
    expect(
      (
        await failure(
          runCapaCommand(lab.outsider, incidentId, { action: "complete", capaId, note: "Done" })
        )
      ).code
    ).toBe("FORBIDDEN");
    await runCapaCommand(lab.member, incidentId, {
      action: "complete",
      capaId,
      note: "Calibrated with the 100 g weight",
    });
    expect(
      (
        await failure(
          runCapaCommand(lab.member, incidentId, { action: "verify", capaId, note: "Fine" })
        )
      ).code
    ).toBe("FORBIDDEN");
    await runCapaCommand(lab.admin, incidentId, {
      action: "verify",
      capaId,
      note: "Daily checks within 0.01 g for a week",
    });

    const detail = (await getIncidentDetail(lab.admin, incidentId))!;
    expect(detail.capaActions.map((c) => [c.kind, c.status, c.due])).toEqual([
      ["CORRECTIVE", "VERIFIED", "2026-11-20"],
      ["PREVENTIVE", "OPEN", null],
    ]);
    const preventive = detail.capaActions[1]!;
    await runCapaCommand(lab.admin, incidentId, {
      action: "complete",
      capaId: preventive.id,
      note: "SOP-004 version 2 drafted",
    });
    await updateIncident(lab.admin, incidentId, { status: "CLOSED", resolution: "Recalibrated" });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "incident", entityId: incidentId },
      orderBy: { id: "asc" },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "incident_open",
      "capa_add",
      "capa_add",
      "capa_complete",
      "capa_verify",
      "capa_complete",
      "incident_update",
    ]);
  });
});
