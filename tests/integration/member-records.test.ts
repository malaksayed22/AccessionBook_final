import { beforeEach, describe, expect, it } from "vitest";
import { getMemberDetail, listMembers, type MemberListParams } from "@/features/member/queries";
import {
  deactivateMember,
  exportMemberData,
  inviteMember,
  pseudonymiseMember,
  reactivateMember,
  resetMemberMfa,
} from "@/features/member/service";
import { pseudonymFor } from "@/lib/invites";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, resetDatabase, verifyChain } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const base: MemberListParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);
const REASON = "Left the laboratory in March";

describe("member list", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab(); // Admin, Member, Outsider, Witness: all active
    await inviteMember(lab.admin, {
      name: "Pending Person",
      email: "pending@example.com",
      role: "REGULAR",
    });
    const expired = await inviteMember(lab.admin, {
      name: "Late Person",
      email: "late@example.com",
      role: "REGULAR",
    });
    await prisma.user.update({
      where: { id: expired.member.id },
      data: { inviteExpiresAt: new Date(Date.now() - 86_400_000) },
    });
    await deactivateMember(lab.admin, lab.outsider.id, undefined, { reason: REASON });
  });

  it("shows administrators every status, with e-mail addresses", async () => {
    const { rows, total } = await listMembers(lab.admin, base);
    expect(total).toBe(6);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["Member"]).toMatchObject({ status: "active", email: "member@example.com" });
    expect(byName["Pending Person"]).toMatchObject({ status: "invited", inviteExpired: false });
    expect(byName["Late Person"]).toMatchObject({ status: "invited", inviteExpired: true });
    expect(byName["Outsider"]).toMatchObject({ status: "deactivated" });
  });

  it("shows other members only the active ones, without e-mail addresses", async () => {
    const { rows, total } = await listMembers(lab.member, base);
    expect(names(rows)).toEqual(["Admin", "Member", "Witness"]);
    expect(total).toBe(3);
    expect(rows.every((r) => r.email === null)).toBe(true);
    // Asking for another status does not widen what a member may see.
    expect((await listMembers(lab.member, { ...base, status: "deactivated" })).total).toBe(3);
    expect((await listMembers(lab.member, { ...base, status: "invited" })).total).toBe(3);
    // Searching by e-mail finds nothing for a member.
    expect((await listMembers(lab.member, { ...base, q: "witness@" })).total).toBe(0);
  });

  it("filters by status and role in the database", async () => {
    expect(names((await listMembers(lab.admin, { ...base, status: "active" })).rows)).toEqual([
      "Admin",
      "Member",
      "Witness",
    ]);
    expect(names((await listMembers(lab.admin, { ...base, status: "invited" })).rows)).toEqual([
      "Late Person",
      "Pending Person",
    ]);
    expect(names((await listMembers(lab.admin, { ...base, status: "deactivated" })).rows)).toEqual([
      "Outsider",
    ]);
    expect(names((await listMembers(lab.admin, { ...base, access: "ADMIN" })).rows)).toEqual([
      "Admin",
    ]);
  });

  it("searches names, and e-mail for administrators, safely", async () => {
    expect(names((await listMembers(lab.admin, { ...base, q: "PEND" })).rows)).toEqual([
      "Pending Person",
    ]);
    expect(names((await listMembers(lab.admin, { ...base, q: "late@" })).rows)).toEqual([
      "Late Person",
    ]);
    expect((await listMembers(lab.admin, { ...base, q: "%" })).total).toBe(0);
    expect((await listMembers(lab.admin, { ...base, q: "_" })).total).toBe(0);
    expect((await listMembers(lab.admin, { ...base, q: '\'; DROP TABLE "User"; --' })).total).toBe(
      0
    );
  });

  it("sorts by experiments and pages without repeating rows", async () => {
    const byExperiments = await listMembers(lab.admin, {
      ...base,
      sort: "experiments",
      order: "desc",
    });
    expect(byExperiments.rows[0]).toMatchObject({
      name: "Member",
      experimentCount: 1,
      experimentCodes: ["AB1"],
    });
    const first = await listMembers(lab.admin, { ...base, limit: 4 });
    const second = await listMembers(lab.admin, { ...base, limit: 4, page: 2 });
    expect([...names(first.rows), ...names(second.rows)]).toEqual([
      "Admin",
      "Late Person",
      "Member",
      "Outsider",
      "Pending Person",
      "Witness",
    ]);
  });
});

describe("member detail", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    await prisma.user.update({
      where: { id: lab.member.id },
      data: { mfaEnabledAt: new Date(), lastLoginAt: new Date() },
    });
    await prisma.session.createMany({
      data: [
        { userId: lab.member.id, tokenHash: "live-1", expiresAt: new Date(Date.now() + 3_600_000) },
        { userId: lab.member.id, tokenHash: "live-2", expiresAt: new Date(Date.now() + 3_600_000) },
        {
          userId: lab.member.id,
          tokenHash: "revoked",
          expiresAt: new Date(Date.now() + 3_600_000),
          revokedAt: new Date(),
        },
      ],
    });
    await resetMemberMfa(lab.admin, lab.witness.id, undefined, { reason: REASON });
  });

  it("gives administrators the e-mail, two-step status, session count and activity", async () => {
    const detail = (await getMemberDetail(lab.admin, lab.member.id))!;
    expect(detail.admin?.email).toBe("member@example.com");
    expect(detail.security).toMatchObject({ mfaEnabled: true, activeSessions: 2 });
    expect(detail.experiments.map((e) => [e.ecode, e.role])).toEqual([["AB1", "LEAD"]]);
    const adminDetail = (await getMemberDetail(lab.admin, lab.admin.id))!;
    expect(adminDetail.activity?.map((a) => a.action)).toContain("mfa-reset");
  });

  it("shows a member their own security details but nobody else's", async () => {
    const own = (await getMemberDetail(lab.member, lab.member.id))!;
    expect(own.security?.mfaEnabled).toBe(true);
    expect(own.admin).toBeNull();

    const other = (await getMemberDetail(lab.member, lab.witness.id))!;
    expect(other.security).toBeNull();
    expect(other.activity).toBeNull();
    expect(other.admin).toBeNull();
    expect(other.experiments).toEqual([]);
  });

  it("hides invitations and deactivated accounts from other members", async () => {
    const invited = await inviteMember(lab.admin, {
      name: "Pending Person",
      email: "p@example.com",
      role: "REGULAR",
    });
    await deactivateMember(lab.admin, lab.outsider.id, undefined, { reason: REASON });
    expect(await getMemberDetail(lab.member, invited.member.id)).toBeNull();
    expect(await getMemberDetail(lab.member, lab.outsider.id)).toBeNull();
    expect((await getMemberDetail(lab.admin, invited.member.id))?.status).toBe("invited");
    expect((await getMemberDetail(lab.admin, lab.outsider.id))?.status).toBe("deactivated");
    expect(await getMemberDetail(lab.admin, 99999)).toBeNull();
  });
});

describe("member reasons", () => {
  it("keeps the reason of a deactivation and of a two-step reset in the audit trail", async () => {
    await resetDatabase();
    const lab = await createLab();
    await resetMemberMfa(lab.admin, lab.witness.id, undefined, { reason: "Lost phone" });
    await deactivateMember(lab.admin, lab.outsider.id, undefined, { reason: REASON });
    const entries = await prisma.auditLog.findMany({
      where: { action: { in: ["mfa-reset", "deactivate"] } },
      orderBy: { seq: "asc" },
    });
    expect(entries.map((e) => e.reason)).toEqual(["Lost phone", REASON]);
  });
});

describe("pseudonymise member", () => {
  let lab: Lab;
  let leaver: number;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    leaver = lab.outsider.id;
    await prisma.user.update({
      where: { id: leaver },
      data: {
        initials: "OU",
        passwordHash: "argon2-hash",
        passwordChangedAt: new Date(),
        lastLoginAt: new Date(),
        mfaSecretEnc: "secret",
        mfaEnabledAt: new Date(),
        mfaLastStep: 7,
        inviteTokenHash: null,
      },
    });
    await prisma.mfaRecoveryCode.create({ data: { userId: leaver, codeHash: "h" } });
    await prisma.session.create({
      data: {
        userId: leaver,
        tokenHash: "old",
        expiresAt: new Date(),
        ip: "203.0.113.9",
        userAgent: "UA",
      },
    });
    // The leaver did something regulated, under their name.
    await prisma.auditLog.create({
      data: {
        userId: leaver,
        userName: "Outsider",
        userRole: "REGULAR",
        entityType: "unit",
        entityId: 1,
        entityLabel: "P1",
        action: "move",
        summary: "Moved P1 to Room 2",
      },
    });
  });

  const erase = () => pseudonymiseMember(lab.admin, leaver, { reason: "Erasure request 2026-114" });

  it("refuses members who are not deactivated, yourself, and non-administrators", async () => {
    await expectCode(erase(), "CONFLICT"); // still active
    await expectCode(pseudonymiseMember(lab.admin, lab.admin.id, { reason: REASON }), "CONFLICT");
    const invited = await inviteMember(lab.admin, {
      name: "Pending Person",
      email: "p@example.com",
      role: "REGULAR",
    });
    await expectCode(
      pseudonymiseMember(lab.admin, invited.member.id, { reason: REASON }),
      "CONFLICT"
    );
    await deactivateMember(lab.admin, leaver, undefined, { reason: REASON });
    await expectCode(pseudonymiseMember(lab.member, leaver, { reason: REASON }), "FORBIDDEN");
    await expectCode(pseudonymiseMember(lab.admin, 99999, { reason: REASON }), "NOT_FOUND");
    // Nothing above changed the account.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaver } })).name).toBe("Outsider");
  });

  it("refuses to erase the last administrator", async () => {
    const second = await prisma.user.create({
      data: {
        name: "Second Admin",
        email: "second@example.com",
        permissions: "ADMIN",
        passwordHash: "x",
      },
    });
    await deactivateMember(lab.admin, second.id, undefined, { reason: REASON });
    // The only other administrator is no longer active: nobody would be left.
    await prisma.user.update({ where: { id: lab.admin.id }, data: { active: false } });
    await expectCode(pseudonymiseMember(lab.admin, second.id, { reason: REASON }), "CONFLICT");
    // With an active administrator around, it is allowed.
    await prisma.user.update({ where: { id: lab.admin.id }, data: { active: true } });
    await pseudonymiseMember(lab.admin, second.id, { reason: REASON });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).name).toBe(
      pseudonymFor(second.id)
    );
  });

  it("clears everything personal on the live row and gives a stable pseudonym", async () => {
    await deactivateMember(lab.admin, leaver, undefined, { reason: REASON });
    const result = await erase();
    expect(result.pseudonym).toBe(pseudonymFor(leaver));
    expect(result.pseudonym).toMatch(/^Former member \d{4}$/);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: leaver } });
    expect(user).toMatchObject({
      name: result.pseudonym,
      initials: null,
      email: null,
      active: false,
      passwordHash: "",
      passwordChangedAt: null,
      lastLoginAt: null,
      mfaSecretEnc: null,
      mfaEnabledAt: null,
      mfaLastStep: null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      invitedById: null,
      invitedAt: null,
    });
    expect(await prisma.session.count({ where: { userId: leaver } })).toBe(0);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: leaver } })).toBe(0);
  });

  it("leaves every audit entry untouched, adds its own entry, and keeps the chain valid", async () => {
    await deactivateMember(lab.admin, leaver, undefined, { reason: REASON });
    const before = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });
    await erase();
    const after = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });

    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((e) => e.action === "move")).toMatchObject({ userName: "Outsider" });
    const entry = after.at(-1)!;
    expect(entry).toMatchObject({
      action: "pseudonymise",
      entityType: "member",
      entityId: leaver,
      reason: "Erasure request 2026-114",
      userId: lab.admin.id,
    });
    expect(JSON.stringify(entry)).not.toContain("outsider@example.com");
    expect(entry.summary).not.toContain("Outsider");
    expect(await verifyChain()).toEqual([]);
  });

  it("cannot be repeated, undone by reactivation, or reached through the old name", async () => {
    await deactivateMember(lab.admin, leaver, undefined, { reason: REASON });
    await erase();
    await expectCode(erase(), "CONFLICT");
    await expectCode(reactivateMember(lab.admin, leaver), "CONFLICT");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaver } })).active).toBe(false);
    // The name is free again, and the reserved pseudonym cannot be taken by a new invitation.
    await inviteMember(lab.admin, {
      name: "Outsider",
      email: "again@example.com",
      role: "REGULAR",
    });
    await expectCode(
      inviteMember(lab.admin, {
        name: "Former member 0042",
        email: "fm@example.com",
        role: "REGULAR",
      }),
      "VALIDATION"
    );
  });
});

describe("export member data", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    await prisma.user.update({
      where: { id: lab.member.id },
      data: {
        initials: "ME",
        passwordHash: "argon2-hash-secret",
        mfaSecretEnc: "mfa-secret-material",
        mfaEnabledAt: new Date(),
        inviteTokenHash: "invite-hash-secret",
      },
    });
    await prisma.session.create({
      data: {
        userId: lab.member.id,
        tokenHash: "token-hash-secret",
        expiresAt: new Date(Date.now() + 3_600_000),
        ip: "203.0.113.9",
        userAgent: "Firefox",
      },
    });
    await prisma.mfaRecoveryCode.createMany({
      data: [
        { userId: lab.member.id, codeHash: "a" },
        { userId: lab.member.id, codeHash: "b", usedAt: new Date() },
      ],
    });
    await prisma.auditLog.create({
      data: {
        userId: lab.member.id,
        userName: "Member",
        userRole: "REGULAR",
        entityType: "unit",
        entityId: 5,
        entityLabel: "P5",
        action: "move",
        summary: "Moved P5",
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: lab.admin.id,
        userName: "Admin",
        userRole: "ADMIN",
        entityType: "unit",
        entityId: 6,
        entityLabel: "P6",
        action: "move",
        summary: "Unrelated entry",
      },
    });
    await resetMemberMfa(lab.admin, lab.member.id, undefined, { reason: REASON });
  });

  it("is for administrators only", async () => {
    await expectCode(exportMemberData(lab.member, lab.member.id), "FORBIDDEN");
    await expectCode(exportMemberData(lab.admin, 99999), "NOT_FOUND");
  });

  it("holds the profile, experiments, sessions and every audit entry by or about the member", async () => {
    // The second-factor reset above cleared MFA; put it back so the export has something to say.
    await prisma.user.update({ where: { id: lab.member.id }, data: { mfaEnabledAt: new Date() } });
    const data = await exportMemberData(lab.admin, lab.member.id);

    expect(data.format).toBe("accession-book/member-export@1");
    expect(data.exportedBy).toEqual({ id: lab.admin.id, name: "Admin" });
    expect(data.profile).toMatchObject({
      id: lab.member.id,
      name: "Member",
      initials: "ME",
      email: "member@example.com",
      permissions: "REGULAR",
      passwordSet: true,
      invitationPending: true,
      twoStepVerificationEnabled: true,
      unusedRecoveryCodes: 0,
    });
    expect(data.profile.experiments).toEqual([
      { role: "LEAD", experiment: expect.objectContaining({ ecode: "AB1" }) },
    ]);
    expect(data.sessions).toHaveLength(1); // revoked by the reset, still on record
    expect(data.sessions[0]).toMatchObject({
      ip: "203.0.113.9",
      userAgent: "Firefox",
      revokedReason: "mfa-reset",
    });

    const summaries = data.auditEntries.map((e) => e.summary);
    expect(summaries).toContain("Moved P5"); // by the member
    expect(summaries.some((s) => s.includes("Reset two-step verification for Member"))).toBe(true); // about them
    expect(summaries).not.toContain("Unrelated entry");
    expect(data.auditEntriesTruncated).toBe(false);
  });

  it("never includes password hashes, second-factor secrets or tokens", async () => {
    const text = JSON.stringify(await exportMemberData(lab.admin, lab.member.id));
    for (const secret of [
      "argon2-hash-secret",
      "mfa-secret-material",
      "invite-hash-secret",
      "token-hash-secret",
      "passwordHash",
      "mfaSecretEnc",
      "tokenHash",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("is itself recorded in the audit trail", async () => {
    const before = await prisma.auditLog.count({ where: { action: "export" } });
    await exportMemberData(lab.admin, lab.member.id);
    const entries = await prisma.auditLog.findMany({ where: { action: "export" } });
    expect(entries).toHaveLength(before + 1);
    expect(entries[0]).toMatchObject({
      entityType: "member",
      entityId: lab.member.id,
      userId: lab.admin.id,
    });
    expect(await verifyChain()).toEqual([]);
  });
});
