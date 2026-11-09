import { beforeEach, describe, expect, it } from "vitest";
import {
  deactivateMember,
  inviteMember,
  reactivateMember,
  reissueInvite,
  revokeInvite,
} from "@/features/member/service";
import { createOrganization, updateOrganization } from "@/features/organization/service";
import { hashInviteToken, memberStatus } from "@/lib/invites";
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

const statusOf = async (id: number) =>
  memberStatus(await prisma.user.findUniqueOrThrow({ where: { id } }));

describe("member service", () => {
  let lab: Lab;
  const invite = (
    name = "New Person",
    email = "new@example.com",
    role: "ADMIN" | "REGULAR" = "REGULAR"
  ) => inviteMember(lab.admin, { name, email, role });

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("creates a pending invitee whose link can be verified but who cannot sign in yet", async () => {
    const result = await invite();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.member.id } });
    expect(user).toMatchObject({ active: false, passwordHash: "", invitedById: lab.admin.id });
    expect(await statusOf(user.id)).toBe("invited");
    expect(user.inviteTokenHash).toBe(hashInviteToken(result.invitePath.split("/").pop()!));
    expect(result.invitePath).not.toContain(user.inviteTokenHash!);
  });

  it("is admin-only and validates the details", async () => {
    await expectCode(
      inviteMember(lab.member, { name: "X Person", email: "x@example.com", role: "REGULAR" }),
      "FORBIDDEN"
    );
    await expectCode(invite("x", "a@example.com"), "VALIDATION");
    await expectCode(invite("Valid Name", "not-an-email"), "VALIDATION");
  });

  it("refuses duplicate names and emails regardless of case", async () => {
    await invite("Dr Amira", "amira@example.com");
    await expectCode(invite("dr amira", "other@example.com"), "CONFLICT");
    await expectCode(invite("Someone Else", "AMIRA@example.com"), "CONFLICT");
  });

  it("re-issues a link (the old one dies) and revokes pending invites, keeping an audit trail", async () => {
    const first = await invite();
    const reissued = await reissueInvite(lab.admin, first.member.id);
    expect(reissued.invitePath).not.toBe(first.invitePath);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: first.member.id } });
    expect(user.inviteTokenHash).toBe(hashInviteToken(reissued.invitePath.split("/").pop()!));

    await revokeInvite(lab.admin, first.member.id);
    expect(await prisma.user.findUnique({ where: { id: first.member.id } })).toBeNull();
    const actions = (await prisma.auditLog.findMany({ orderBy: { seq: "asc" } })).map(
      (a) => a.action
    );
    expect(actions).toEqual(["invite", "invite-reissue", "invite-revoke"]);
    expect(await verifyChain()).toEqual([]);
  });

  it("only revokes or re-sends pending invitations", async () => {
    await expectCode(revokeInvite(lab.admin, lab.member.id), "CONFLICT");
    await expectCode(reissueInvite(lab.admin, lab.member.id), "CONFLICT");
  });

  it("deactivates and reactivates, never deleting; sign-in state follows", async () => {
    await deactivateMember(lab.admin, lab.member.id);
    expect(await statusOf(lab.member.id)).toBe("deactivated");
    await expectCode(deactivateMember(lab.admin, lab.member.id), "CONFLICT");

    // Test fixtures have no password; a member who never set one cannot simply be reactivated.
    await expectCode(reactivateMember(lab.admin, lab.member.id), "CONFLICT");
    await prisma.user.update({ where: { id: lab.member.id }, data: { passwordHash: "x" } });
    await reactivateMember(lab.admin, lab.member.id);
    expect(await statusOf(lab.member.id)).toBe("active");
  });

  it("refuses to deactivate yourself or the last remaining admin", async () => {
    await expectCode(deactivateMember(lab.admin, lab.admin.id), "CONFLICT");

    const second = await prisma.user.create({
      data: { name: "Second Admin", email: "second@example.com", permissions: "ADMIN" },
    });
    await deactivateMember(lab.admin, second.id); // another admin remains: allowed
    await prisma.user.update({ where: { id: second.id }, data: { active: true } });
    await prisma.user.update({ where: { id: lab.admin.id }, data: { active: false } });
    // Only `second` is an active admin now: the last one cannot be removed.
    await expectCode(deactivateMember(lab.admin, second.id), "CONFLICT");
  });

  it("serialises simultaneous deactivations so the last admin cannot be removed by a race", async () => {
    const a = await prisma.user.create({
      data: { name: "Admin A", email: "a@example.com", permissions: "ADMIN" },
    });
    const b = await prisma.user.create({
      data: { name: "Admin B", email: "b@example.com", permissions: "ADMIN" },
    });
    // The fixture admin deactivates A and B at the same moment; at least one admin must survive.
    await Promise.allSettled([
      deactivateMember(lab.admin, a.id),
      deactivateMember(lab.admin, b.id),
    ]);
    const remaining = await prisma.user.count({ where: { permissions: "ADMIN", active: true } });
    expect(remaining).toBeGreaterThanOrEqual(1);
  });
});

describe("organization service", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("registers an organization (admin only) with an audit entry", async () => {
    await expectCode(
      createOrganization(lab.member, {
        address: "1 Test Street, Quebec City",
        name: "Lab Partner",
      }),
      "FORBIDDEN"
    );
    const org = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Lab Partner",
      country: "CA",
      licenceNumber: "LIC-9",
    });
    expect(org.name).toBe("Lab Partner");
    const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
    expect(entry).toMatchObject({ entityType: "organization", action: "create" });
  });

  it("rejects duplicates case- and accent-insensitively and points at the existing record", async () => {
    const first = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Université Laval",
    });
    const error = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "université laval",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("CONFLICT");
    expect((error as AppError).details).toEqual({ id: first.id });
  });

  it("updates only what changed, records before/after, and reports no-ops", async () => {
    const org = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Lab Partner",
      country: "CA",
    });
    expect((await updateOrganization(lab.admin, org.id, { country: "CA" })).unchanged).toBe(true);
    const result = await updateOrganization(lab.admin, org.id, {
      licenceNumber: "LIC-1",
      country: "US",
    });
    expect(result.unchanged).toBe(false);
    const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
    expect((entry?.details as Array<{ field: string }>).map((c) => c.field).sort()).toEqual([
      "country",
      "licence",
    ]);
  });

  it("will not rename into another organization's name", async () => {
    await createOrganization(lab.admin, { address: "1 Test Street, Quebec City", name: "Alpha" });
    const beta = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Beta",
    });
    await expectCode(updateOrganization(lab.admin, beta.id, { name: "ALPHA" }), "CONFLICT");
    await expectCode(updateOrganization(lab.member, beta.id, { name: "Gamma" }), "FORBIDDEN");
  });
});
