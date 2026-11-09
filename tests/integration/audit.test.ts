import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { logMemberActivity } from "@/server/audit";
import { appendAudit, createUser, resetDatabase, verifyChain } from "./helpers";

describe("audit trail integrity", () => {
  let userId: number;

  beforeEach(async () => {
    await resetDatabase();
    userId = (await createUser("Auditor")).id;
  });

  it("assigns a contiguous sequence and links every row to its predecessor", async () => {
    for (const n of [1, 2, 3]) await appendAudit(userId, `event ${n}`);

    const rows = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0]?.prevHash).toBe("");
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash);
    expect(rows[2]?.prevHash).toBe(rows[1]?.hash);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
    expect(await verifyChain()).toEqual([]);
  });

  it("ignores any seq or hash an application tries to supply", async () => {
    const forged = await prisma.auditLog.create({
      data: {
        userId,
        userName: "x",
        userRole: "ADMIN",
        entityType: "t",
        entityId: 1,
        entityLabel: "t",
        action: "a",
        summary: "forged",
        seq: 999,
        prevHash: "f".repeat(64),
        hash: "0".repeat(64),
      },
    });
    expect(forged.seq).toBe(1);
    expect(forged.prevHash).toBe("");
    expect(forged.hash).not.toBe("0".repeat(64));
    expect(await verifyChain()).toEqual([]);
  });

  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    const row = await appendAudit(userId, "immutable");

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { summary: "edited" } })
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);

    const [stillThere] = await prisma.auditLog.findMany();
    expect(stillThere?.summary).toBe("immutable");
  });

  it("detects a row altered by someone who bypasses the guard (e.g. a superuser)", async () => {
    for (const n of [1, 2, 3, 4]) await appendAudit(userId, `event ${n}`);
    expect(await verifyChain()).toEqual([]);

    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_no_update_delete`);
    await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "summary" = 'rewritten' WHERE "seq" = 2`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_no_update_delete`);

    const [problem] = await verifyChain();
    expect(problem?.broken_seq).toBe(2);
    expect(problem?.reason).toMatch(/altered/);
  });

  it("detects a row removed from the middle of history", async () => {
    for (const n of [1, 2, 3, 4]) await appendAudit(userId, `event ${n}`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_no_update_delete`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "seq" = 2`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_no_update_delete`);

    const [problem] = await verifyChain();
    expect(problem?.broken_seq).toBe(3);
    expect(problem?.reason).toMatch(/sequence gap/);
  });

  it("keeps the chain linear under concurrent writers", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => appendAudit(userId, `parallel ${i}`)));

    const rows = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(await verifyChain()).toEqual([]);
  });

  it("commits with the change it describes, and vanishes with it on rollback", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.organization.create({ data: { name: "Rolled Back Org" } });
        await logMemberActivity(
          { id: userId, name: "Auditor", permissions: "ADMIN" },
          {
            entityType: "organization",
            entityId: 1,
            entityLabel: "Rolled Back Org",
            action: "create",
            summary: "should not persist",
          },
          tx
        );
        throw new Error("simulated failure after both writes");
      })
    ).rejects.toThrow(/simulated failure/);

    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);

    // The sequence did not advance: the next entry is still position 1.
    expect((await appendAudit(userId, "after rollback")).seq).toBe(1);
    expect(await verifyChain()).toEqual([]);
  });

  it("stores structured changes as JSON", async () => {
    await logMemberActivity(
      { id: userId, name: "Auditor", permissions: "ADMIN" },
      {
        entityType: "unit",
        entityId: 7,
        entityLabel: "U-7",
        action: "hold",
        summary: "held",
        changes: [{ field: "hold", from: null, to: "HOLD" }],
        reason: "failed potency",
        requestId: "req-1",
        ip: "203.0.113.9",
      }
    );
    const [row] = await prisma.auditLog.findMany();
    expect(row?.details).toEqual([{ field: "hold", from: null, to: "HOLD" }]);
    expect(row?.reason).toBe("failed potency");
    expect(row?.requestId).toBe("req-1");
    expect(row?.ip).toBe("203.0.113.9");
  });
});
