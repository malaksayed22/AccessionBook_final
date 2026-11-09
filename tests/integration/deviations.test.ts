import { beforeEach, describe, expect, it } from "vitest";
import { getIncidentDetail } from "@/features/qa/queries";
import { openIncident, updateIncident } from "@/features/qa/service";
import { getSop } from "@/features/sop/queries";
import { createSop } from "@/features/sop/service";
import { AppError } from "@/server/errors";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

describe("deviations from a procedure", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("links an incident to the procedure it departed from, shown on both sides", async () => {
    const sop = await createSop(lab.admin, {
      code: "SOP-004",
      title: "Daily scale check",
      body: "1. Weigh the 1 g check weight.\n2. Record the reading.",
    });
    const { incidentId } = await openIncident(lab.admin, {
      title: "Daily check skipped",
      description: "No reading recorded on Monday.",
      severity: "MINOR",
    });
    await updateIncident(lab.admin, incidentId, { sopId: sop.id });

    expect((await getIncidentDetail(lab.admin, incidentId))?.sop).toMatchObject({
      code: "SOP-004",
    });
    expect((await getSop(lab.member, sop.id))?.deviations.map((d) => d.title)).toEqual([
      "Daily check skipped",
    ]);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "incident", entityId: incidentId, action: "incident_update" },
      select: { details: true },
    });
    expect(JSON.stringify(audit?.details)).toContain("SOP-004");

    // An unknown procedure is refused, and null clears the link.
    const missing = await updateIncident(lab.admin, incidentId, { sopId: 999_999 }).catch(
      (e: unknown) => e
    );
    expect(missing).toBeInstanceOf(AppError);
    await updateIncident(lab.admin, incidentId, { sopId: null });
    expect((await getSop(lab.admin, sop.id))?.deviations).toEqual([]);
  });

  it("lists a deviation on a unit only to those who may see the unit", async () => {
    const sop = await createSop(lab.admin, {
      code: "SOP-007",
      title: "Watering",
      body: "Water each plant with 250 ml every second day.",
    });
    const unit = await registerOne(lab, { name: "P-DEV" });
    const { incidentId } = await openIncident(lab.admin, {
      title: "Overwatered",
      description: "Watered daily for a week.",
      severity: "MINOR",
      unitId: unit.id,
    });
    await updateIncident(lab.admin, incidentId, { sopId: sop.id });
    expect((await getSop(lab.member, sop.id))?.deviations).toHaveLength(1);
    expect((await getSop(lab.outsider, sop.id))?.deviations).toEqual([]);
  });
});
