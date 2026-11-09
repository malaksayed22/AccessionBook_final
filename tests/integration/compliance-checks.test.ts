import { beforeEach, describe, expect, it } from "vitest";
import { HoldKind } from "@/generated/prisma/enums";
import { verifyAuditChain } from "@/features/audit/queries";
import { runComplianceChecks } from "@/features/compliance/queries";
import { OFFENDER_LIMIT } from "@/lib/compliance";
import { placeHold } from "@/features/qa/service";
import { destroyUnit } from "@/features/unit/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

process.env.LAB_TIMEZONE = "America/Toronto";

type Lab = Awaited<ReturnType<typeof createLab>>;
const findingOf = (report: Awaited<ReturnType<typeof runComplianceChecks>>, id: string) =>
  report.findings.find((f) => f.id === id);

describe("compliance console", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("passes every check on a laboratory with clean records", async () => {
    await registerOne(lab, { name: "Clean-1" });
    const checks = await runComplianceChecks();
    expect(checks.totalChecks).toBe(12);
    expect(checks.criticalCount).toBe(0);
    expect(checks.warningCount).toBe(0);
    expect(checks.passingCount).toBe(12);
  });

  it("counts every offender but lists only the first few", async () => {
    // Units with no cultivar are a warning; the count must be exact even past the display cap.
    const total = OFFENDER_LIMIT + 5;
    for (let n = 1; n <= total; n += 1) {
      await registerOne(lab, { name: `NoCult-${String(n).padStart(2, "0")}` });
    }
    await prisma.biologicalUnit.updateMany({ data: { cultivarId: null } });
    const report = await runComplianceChecks();
    const finding = findingOf(report, "cultivar-attribution");
    expect(finding).toMatchObject({ count: total, passing: false, severity: "warning" });
    expect(finding?.offenders).toHaveLength(OFFENDER_LIMIT);
    expect(finding?.offenders[0]).toMatchObject({
      label: "NoCult-01",
      detail: { key: "noCultivar", params: {} },
    });
    expect(report.warningCount).toBeGreaterThanOrEqual(1);
  });

  it("explains each offender with a key and parameters, never prose", async () => {
    const held = await registerOne(lab, { name: "Held-1" });
    await placeHold(lab.member, held.id, { reason: "Suspected mites", kind: HoldKind.HOLD });

    const report = await runComplianceChecks();
    expect(
      findingOf(report, "quality-holds")?.offenders.find((o) => o.label === "Held-1")?.detail
    ).toEqual({
      key: "hold",
      params: { kind: "HOLD", reason: "Suspected mites" },
    });
    expect(findingOf(report, "quality-holds")?.offenders[0]).toMatchObject({
      href: expect.stringMatching(/^\/inventory\/units\/\d+$/),
    });
    expect(report.warningCount).toBeGreaterThanOrEqual(1);
  });

  it("flags a destruction filed more than 30 days after it happened", async () => {
    const day = 86_400_000;
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
    const onTime = await registerOne(lab, { name: "OnTime-1", effectiveAt: iso(60) });
    const late = await registerOne(lab, { name: "Late-1", effectiveAt: iso(60) });
    const reason = "Mildew, destroyed per SOP";
    // Both are filed today. One happened 5 days ago, the other 45 days ago.
    await destroyUnit(lab.admin, onTime.id, {
      reason,
      effectiveAt: iso(5),
    } as Parameters<typeof destroyUnit>[2]);
    await destroyUnit(lab.admin, late.id, {
      reason,
      effectiveAt: iso(45),
    } as Parameters<typeof destroyUnit>[2]);

    const finding = findingOf(await runComplianceChecks(), "destruction-filed-promptly");
    expect(finding).toMatchObject({ count: 1, passing: false, severity: "warning" });
    expect(finding?.offenders).toHaveLength(1);
    expect(finding?.offenders[0]).toMatchObject({ label: "Late-1" });
    expect(finding?.offenders[0]?.detail.key).toBe("filedLate");
    expect(finding?.offenders[0]?.detail.params.days).toBe(45);
  });

  it("shows a broken audit chain to administrators", async () => {
    await registerOne(lab, { name: "Chain-1" });
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_no_update_delete`);
    await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "summary" = 'rewritten' WHERE "seq" = 1`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_no_update_delete`);

    const chain = await verifyAuditChain(lab.admin);
    expect(chain).toMatchObject({ intact: false, firstBroken: { seq: 1, kind: "contentAltered" } });
  });
});
