import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuditFilterOptions,
  listAuditEntries,
  listRecentAuditEntries,
  verifyAuditChain,
  type AuditListParams,
} from "@/features/audit/queries";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { asActor, createUser, resetDatabase } from "./helpers";

process.env.LAB_TIMEZONE = "America/Toronto";

const base: AuditListParams = { order: "desc", page: 1, limit: 10 };

type Entry = {
  userId: number;
  userName: string;
  entityType: string;
  entityId: number;
  entityLabel: string;
  action: string;
  summary: string;
  at: string;
  reason?: string;
  requestId?: string;
  details?: Array<{ field: string; from: string | null; to: string | null }>;
};

async function write(entry: Entry) {
  return prisma.auditLog.create({
    data: {
      userId: entry.userId,
      userName: entry.userName,
      userRole: "ADMIN",
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel,
      action: entry.action,
      summary: entry.summary,
      reason: entry.reason,
      requestId: entry.requestId,
      details: entry.details,
      createdAt: new Date(entry.at),
    },
  });
}

async function tamper(sql: string) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_no_update_delete`);
  try {
    await prisma.$executeRawUnsafe(sql);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_no_update_delete`);
  }
}

describe("audit queries", () => {
  let admin: ReturnType<typeof asActor>;
  let member: ReturnType<typeof asActor>;
  let ana: { id: number; name: string };
  let ben: { id: number; name: string };

  beforeEach(async () => {
    await resetDatabase();
    const adminUser = await prisma.user.create({
      data: { name: "Root", email: "root@example.com", permissions: "ADMIN" },
    });
    admin = asActor(adminUser);
    member = asActor(await createUser("Plain"));
    ana = await createUser("Ana");
    ben = await createUser("Ben");

    // Seven entries. Times are chosen around Toronto midnight: 03:00Z on 1 March is 22:00 on 28 Feb.
    await write({
      userId: ana.id,
      userName: "Ana",
      entityType: "unit",
      entityId: 1,
      entityLabel: "P-1",
      action: "create",
      summary: "Registered P-1",
      at: "2026-02-27T15:00:00Z",
      requestId: "req-aaa",
    });
    await write({
      userId: ana.id,
      userName: "Ana",
      entityType: "unit",
      entityId: 1,
      entityLabel: "P-1",
      action: "transfer",
      summary: "Moved P-1 to Room 2",
      at: "2026-02-28T20:00:00Z",
      details: [{ field: "location", from: "Room 1", to: "Room 2" }],
    });
    await write({
      userId: ben.id,
      userName: "Ben",
      entityType: "unit",
      entityId: 2,
      entityLabel: "P-2",
      action: "destroy",
      summary: "Destroyed P-2",
      at: "2026-03-01T03:00:00Z",
      reason: "Mildew found",
    });
    await write({
      userId: ben.id,
      userName: "Ben",
      entityType: "experiment",
      entityId: 5,
      entityLabel: "AB5",
      action: "update",
      summary: "Renamed experiment 50% done",
      at: "2026-03-01T05:30:00Z",
    });
    await write({
      userId: ana.id,
      userName: "Ana",
      entityType: "organization",
      entityId: 3,
      entityLabel: "Acme_Labs",
      action: "create",
      summary: "Added organization",
      at: "2026-03-02T15:00:00Z",
    });
    await write({
      userId: ana.id,
      userName: "Ana",
      entityType: "unit",
      entityId: 3,
      entityLabel: "P-3",
      action: "create",
      summary: "Registered P-3",
      at: "2026-03-03T15:00:00Z",
    });
    await write({
      userId: ben.id,
      userName: "Ben",
      entityType: "unit",
      entityId: 3,
      entityLabel: "P-3",
      action: "transfer",
      summary: "Moved P-3",
      at: "2026-03-04T15:00:00Z",
    });
  });

  const summaries = async (params: Partial<AuditListParams> = {}) =>
    (await listAuditEntries(admin, { ...base, ...params })).rows.map((r) => r.summary);

  it("is for administrators only, on every read", async () => {
    for (const read of [
      () => listAuditEntries(member, base),
      () => listRecentAuditEntries(member),
      () => getAuditFilterOptions(member),
      () => verifyAuditChain(member),
    ]) {
      const error = await read().then(
        () => null,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("returns newest first by default and oldest first on request, by chain position", async () => {
    const newest = await listAuditEntries(admin, base);
    expect(newest.total).toBe(7);
    expect(newest.rows.map((r) => r.seq)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect((await listAuditEntries(admin, { ...base, order: "asc" })).rows[0]?.seq).toBe(1);
  });

  it("filters by person, record type and action, alone and together", async () => {
    expect(await summaries({ actorId: ben.id })).toEqual([
      "Moved P-3",
      "Renamed experiment 50% done",
      "Destroyed P-2",
    ]);
    expect((await listAuditEntries(admin, { ...base, entityType: "unit" })).total).toBe(5);
    expect((await listAuditEntries(admin, { ...base, action: "create" })).total).toBe(3);
    expect(await summaries({ actorId: ana.id, entityType: "unit", action: "transfer" })).toEqual([
      "Moved P-1 to Room 2",
    ]);
    expect((await listAuditEntries(admin, { ...base, entityType: "nonsense" })).total).toBe(0);
  });

  it("filters by laboratory calendar days, not UTC days", async () => {
    // 28 February in Toronto: the 20:00Z entry and the 03:00Z entry of 1 March (22:00 on the 28th).
    expect(await summaries({ from: "2026-02-28", to: "2026-02-28", order: "asc" })).toEqual([
      "Moved P-1 to Room 2",
      "Destroyed P-2",
    ]);
    // From 1 March: starts at 05:00Z, so the 03:00Z entry is excluded and the 05:30Z one is in.
    expect((await summaries({ from: "2026-03-01", order: "asc" }))[0]).toBe(
      "Renamed experiment 50% done"
    );
    expect(await summaries({ to: "2026-02-27" })).toEqual(["Registered P-1"]);
  });

  it("searches summary, record, person, reason, request id and entry number, ignoring case", async () => {
    expect(await summaries({ q: "moved" })).toEqual(["Moved P-3", "Moved P-1 to Room 2"]);
    expect(await summaries({ q: "acme" })).toEqual(["Added organization"]);
    expect(await summaries({ q: "BEN" })).toHaveLength(3);
    expect(await summaries({ q: "mildew" })).toEqual(["Destroyed P-2"]);
    expect(await summaries({ q: "req-aaa" })).toEqual(["Registered P-1"]);
    expect(await summaries({ q: "4" })).toContain("Renamed experiment 50% done"); // entry number 4
  });

  it("treats search text as text, not as a pattern", async () => {
    expect(await summaries({ q: "50%" })).toEqual(["Renamed experiment 50% done"]);
    expect(await summaries({ q: "%" })).toEqual(["Renamed experiment 50% done"]);
    expect(await summaries({ q: "Acme_Labs" })).toEqual(["Added organization"]);
    expect(await summaries({ q: "Acme.Labs" })).toEqual([]);
    expect(await summaries({ q: "_" })).toEqual(["Added organization"]);
    expect(
      (await listAuditEntries(admin, { ...base, q: '\'; DROP TABLE "AuditLog"; --' })).total
    ).toBe(0);
    expect((await listAuditEntries(admin, base)).total).toBe(7);
  });

  it("pages in the database without repeating or skipping entries", async () => {
    const first = await listAuditEntries(admin, { ...base, limit: 3 });
    const second = await listAuditEntries(admin, { ...base, limit: 3, page: 2 });
    const third = await listAuditEntries(admin, { ...base, limit: 3, page: 3 });
    expect(first.total).toBe(7);
    expect([...first.rows, ...second.rows, ...third.rows].map((r) => r.seq)).toEqual([
      7, 6, 5, 4, 3, 2, 1,
    ]);
    expect(third.rows).toHaveLength(1);
    expect((await listAuditEntries(admin, { ...base, limit: 3, page: 9 })).rows).toEqual([]);
  });

  it("returns who, what, when, the before/after changes, the reason and the request id", async () => {
    const { rows } = await listAuditEntries(admin, { ...base, order: "asc" });
    expect(rows[1]).toMatchObject({
      seq: 2,
      actorName: "Ana",
      entityType: "unit",
      entityId: 1,
      entityLabel: "P-1",
      action: "transfer",
      changes: [{ field: "location", from: "Room 1", to: "Room 2" }],
    });
    expect(rows[2]).toMatchObject({ reason: "Mildew found" });
    expect(rows[0]).toMatchObject({ requestId: "req-aaa", changes: [] });
  });

  it("offers only values that exist in the trail", async () => {
    const options = await getAuditFilterOptions(admin);
    expect(options.actors.map((a) => a.name)).toEqual(["Ana", "Ben"]);
    expect(options.entityTypes).toEqual(["experiment", "organization", "unit"]);
    expect(options.actions).toEqual(["create", "destroy", "transfer", "update"]);
  });

  it("lists the newest entries for the dashboard", async () => {
    const recent = await listRecentAuditEntries(admin, 3);
    expect(recent.map((r) => r.seq)).toEqual([7, 6, 5]);
  });

  describe("chain verification", () => {
    it("reports an intact chain with its length", async () => {
      const status = await verifyAuditChain(admin);
      expect(status).toMatchObject({ intact: true, entries: 7, lastSeq: 7, firstBroken: null });
      expect(status.verifiedAt).toBeInstanceOf(Date);
    });

    it("treats an empty trail as nothing to verify, not as a failure", async () => {
      await resetDatabase();
      const root = asActor(
        await prisma.user.create({
          data: { name: "Root2", email: "r2@example.com", permissions: "ADMIN" },
        })
      );
      expect(await verifyAuditChain(root)).toMatchObject({
        intact: true,
        entries: 0,
        lastSeq: null,
      });
    });

    it("finds a row altered by someone who bypasses the guard, and names the first broken entry", async () => {
      await tamper(`UPDATE "AuditLog" SET "summary" = 'rewritten' WHERE "seq" = 3`);
      const status = await verifyAuditChain(admin);
      expect(status.intact).toBe(false);
      expect(status.firstBroken).toMatchObject({ seq: 3, kind: "contentAltered" });
    });

    it("finds a row removed from the middle of history", async () => {
      await tamper(`DELETE FROM "AuditLog" WHERE "seq" = 4`);
      const status = await verifyAuditChain(admin);
      expect(status.intact).toBe(false);
      expect(status.firstBroken).toMatchObject({ seq: 5, kind: "sequenceGap" });
    });

    it("reports the first of several problems", async () => {
      await tamper(`UPDATE "AuditLog" SET "summary" = 'x' WHERE "seq" IN (2, 6)`);
      expect((await verifyAuditChain(admin)).firstBroken?.seq).toBe(2);
    });
  });
});
