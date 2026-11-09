import { beforeAll, describe, expect, it } from "vitest";
import { HoldKind, TestPanel } from "@/generated/prisma/enums";
import { listAuditEntries } from "@/features/audit/queries";
import { getExperimentDetail } from "@/features/experiment/queries";
import { createLocation } from "@/features/location/service";
import { changeMemberRole } from "@/features/member/service";
import { placeHold, recordLabTest, releaseHold } from "@/features/qa/service";
import { loadReport } from "@/features/report/queries";
import { getUnitProfile } from "@/features/unit/queries";
import { destroyUnit, measureUnit, moveUnit } from "@/features/unit/service";
import type { Role } from "@/lib/roles";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { asActor, createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function code(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return (error as AppError).code;
}

const audit = { sort: "seq" as const, order: "desc" as const, page: 1, limit: 10 };

describe("roles beyond administrator and member", () => {
  let lab: Lab;
  let unitId: number;
  const actors = {} as Record<"QA" | "INVENTORY" | "INSPECTOR", ReturnType<typeof asActor>>;

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    for (const role of ["QA", "INVENTORY", "INSPECTOR"] as const) {
      const user = await prisma.user.create({
        data: { name: role, email: `${role.toLowerCase()}@example.com`, permissions: role },
      });
      actors[role] = asActor(user);
    }
    // A unit of an experiment none of them belongs to.
    unitId = (await registerOne(lab, { name: "ROLE-1" })).id;
  });

  it("lets each of them see the whole laboratory", async () => {
    for (const actor of Object.values(actors)) {
      expect(await getUnitProfile(actor, unitId)).not.toBeNull();
      expect(await getExperimentDetail(actor, lab.experiment.id)).not.toBeNull();
    }
    // A member who is not on the experiment still does not see it.
    expect(await getUnitProfile(lab.outsider, unitId)).toBeNull();
  });

  it("lets quality assurance hold, test and release, but not move or destroy", async () => {
    const qa = actors.QA;
    const profile = (await getUnitProfile(qa, unitId))!;
    expect(profile.access).toMatchObject({
      canEdit: false,
      canRecordQuality: true,
      canReleaseHold: true,
    });
    await recordLabTest(qa, unitId, {
      panel: TestPanel.POTENCY,
      wetWeight: 2,
      labName: "Analytica",
    } as never);
    await placeHold(qa, unitId, { kind: HoldKind.HOLD, reason: "Mould on two leaves" });
    await releaseHold(qa, unitId, { note: "Leaves removed, rest is clean" });
    expect(
      await code(moveUnit(qa, unitId, { toLocationId: lab.rooms[1].id }, { requireScan: false }))
    ).toBe("FORBIDDEN");
    expect(await code(destroyUnit(qa, unitId, { reason: "Not allowed here" } as never))).toBe(
      "FORBIDDEN"
    );
    expect(await code(createLocation(qa, { name: "QA room", code: "QA-1" }))).toBe("FORBIDDEN");
  });

  it("lets an inventory manager work on any unit and add locations, but not release or destroy", async () => {
    const inventory = actors.INVENTORY;
    expect((await getUnitProfile(inventory, unitId))!.access).toMatchObject({
      canEdit: true,
      canReleaseHold: false,
    });
    await moveUnit(inventory, unitId, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await measureUnit(inventory, unitId, { humidWeight: 12 });
    await createLocation(inventory, { name: "Overflow room", code: "OVF-1" });

    await placeHold(inventory, unitId, { kind: HoldKind.HOLD, reason: "Count does not match" });
    expect(await code(releaseHold(inventory, unitId, { note: "Recounted, all fine" }))).toBe(
      "FORBIDDEN"
    );
    await releaseHold(actors.QA, unitId, { note: "Recounted, all fine" });
    expect(
      await code(destroyUnit(inventory, unitId, { reason: "Not allowed here" } as never))
    ).toBe("FORBIDDEN");
    expect(await code(loadReport(inventory, "ctls-monthly", {}))).toBe("FORBIDDEN");
  });

  it("lets an inspector read the reports and the audit trail, and offers them no action", async () => {
    const inspector = actors.INSPECTOR;
    await expect(loadReport(inspector, "ctls-monthly", {})).resolves.toBeDefined();
    expect((await listAuditEntries(inspector, audit as never)).total).toBeGreaterThan(0);
    expect((await getUnitProfile(inspector, unitId))!.access).toMatchObject({
      canEdit: false,
      canRecordQuality: false,
      canReleaseHold: false,
    });
    // Quality assurance reads them too; a member does not.
    await expect(loadReport(actors.QA, "ctls-monthly", {})).resolves.toBeDefined();
    expect(await code(loadReport(lab.member, "ctls-monthly", {}))).toBe("FORBIDDEN");
  });

  it("lets an administrator change a role, never their own and never the last administrator's", async () => {
    const reason = "Joins the quality team";
    await changeMemberRole(lab.admin, lab.member.id, { role: "QA", reason });
    const changed = await prisma.user.findUniqueOrThrow({ where: { id: lab.member.id } });
    expect(changed.permissions).toBe<Role>("QA");
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "role" } });
    expect(entry).toMatchObject({ entityId: lab.member.id, reason });

    expect(await code(changeMemberRole(lab.admin, lab.admin.id, { role: "QA", reason }))).toBe(
      "CONFLICT"
    );
    expect(await code(changeMemberRole(actors.QA, lab.member.id, { role: "ADMIN", reason }))).toBe(
      "FORBIDDEN"
    );
    // With two administrators one may demote the other; the one left keeps the role. (The demoted
    // admin's sessions end, but even a stale one cannot remove the last administrator.)
    await changeMemberRole(lab.admin, actors.INSPECTOR.id, { role: "ADMIN", reason });
    const second = asActor(
      await prisma.user.findUniqueOrThrow({ where: { id: actors.INSPECTOR.id } })
    );
    await changeMemberRole(second, lab.admin.id, { role: "REGULAR", reason });
    expect(await code(changeMemberRole(lab.admin, second.id, { role: "REGULAR", reason }))).toBe(
      "CONFLICT"
    );
    expect(await prisma.session.count({ where: { userId: lab.admin.id, revokedAt: null } })).toBe(
      0
    );
  });
});
