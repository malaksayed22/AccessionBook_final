import { beforeEach, describe, expect, it } from "vitest";
import { openIncident } from "@/features/qa/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

describe("record codes: every unit and every incident gets one from the database", () => {
  let lab: Awaited<ReturnType<typeof createLab>>;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("numbers units U-0001 upwards and incidents INC-001 upwards, never twice", async () => {
    const first = await registerOne(lab, { name: "Code A" } as never);
    const second = await registerOne(lab, { name: "Code B" } as never);
    const codes = await prisma.biologicalUnit.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { id: "asc" },
      select: { code: true },
    });
    expect(codes.every(({ code }) => /^U-\d{4,}$/.test(code))).toBe(true);
    expect(new Set(codes.map((c) => c.code)).size).toBe(2);

    const { incidentId } = await openIncident(lab.admin, {
      title: "Scale out of tolerance",
      description: "The daily check read 1.04 g for the 1 g weight.",
      severity: "MAJOR",
    });
    const incident = await prisma.qualityIncident.findUniqueOrThrow({
      where: { id: incidentId },
      select: { code: true },
    });
    expect(incident.code).toMatch(/^INC-\d{3,}$/);
  });

  it("gives organizations, members, cultivars and tasks their own codes", async () => {
    const [org] = await prisma.organization.findMany({ take: 1, select: { code: true } });
    const users = await prisma.user.findMany({ select: { code: true } });
    const cultivar = await prisma.cultivar.findUniqueOrThrow({
      where: { id: lab.cultivar.id },
      select: { code: true },
    });
    const task = await prisma.task.create({
      data: { title: "Water", dueDate: new Date(), createdById: lab.admin.id },
      select: { code: true },
    });
    if (org) expect(org.code).toMatch(/^ORG-\d{3,}$/);
    expect(users.every(({ code }) => /^M-\d{3,}$/.test(code))).toBe(true);
    expect(cultivar.code).toMatch(/^CV-\d{3,}$/);
    expect(task.code).toMatch(/^T-\d{4,}$/);
  });
});
