import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import {
  createInviteToken,
  invitePath,
  isValidEmail,
  isValidUsername,
  memberStatus,
  pseudonymFor,
  pseudonymNumber,
} from "@/lib/invites";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import { revokeUserSessions } from "@/server/session";
import type { InviteMemberInput } from "./schemas";
import type { Role } from "@/lib/roles";

/**
 * Member lifecycle: invite, re-issue, revoke, deactivate, reactivate. Admin-only. Accounts are
 * deactivated, never deleted, so the audit trail keeps pointing at real people.
 */
type Actor = SessionUser;
type Tx = Prisma.TransactionClient;

export async function inviteMember(actor: Actor, input: InviteMemberInput, meta?: RequestMeta) {
  assertAdmin(actor);
  if (!isValidUsername(input.name)) {
    throw errors.validation(
      "Username must be 2–40 characters: letters, numbers, spaces, dots, dashes or underscores"
    );
  }
  if (pseudonymNumber(input.name) !== null) {
    throw errors.validation("That name is reserved for members whose data was erased");
  }
  if (!isValidEmail(input.email)) throw errors.validation("Enter a valid email address");

  return prisma.$transaction(async (tx) => {
    const [nameTaken, emailTaken] = await Promise.all([
      tx.user.findFirst({
        where: { name: { equals: input.name, mode: "insensitive" } },
        select: { id: true },
      }),
      tx.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: { id: true },
      }),
    ]);
    if (nameTaken) throw errors.conflict(`"${input.name}" is already taken`);
    if (emailTaken) throw errors.conflict("A member with that email already exists");

    const invite = createInviteToken();
    const member = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        permissions: input.role,
        active: false,
        inviteTokenHash: invite.tokenHash,
        inviteExpiresAt: invite.expiresAt,
        invitedById: actor.id,
        invitedAt: new Date(),
      },
      select: { id: true, name: true },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "invite",
      summary: `Invited ${member.name} (${input.email}) as ${input.role === "ADMIN" ? "admin" : "lab member"}`,
      changes: [
        { field: "access", from: null, to: input.role },
        { field: "email", from: null, to: input.email },
      ],
    });
    return {
      member: { id: member.id, name: member.name, email: input.email, role: input.role },
      invitePath: invitePath(invite.token),
      expiresAt: invite.expiresAt.toISOString(),
    };
  });
}

async function loadMember(tx: Tx, id: number) {
  const member = await tx.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      permissions: true,
      active: true,
      passwordHash: true,
      inviteTokenHash: true,
      inviteExpiresAt: true,
    },
  });
  if (!member) throw errors.notFound("Member");
  return member;
}

export async function reissueInvite(actor: Actor, memberId: number, meta?: RequestMeta) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const member = await loadMember(tx, memberId);
    const status = memberStatus(member);
    if (status !== "invited" && status !== "invite-expired") {
      throw errors.conflict("Only pending invitations can be re-sent");
    }
    const invite = createInviteToken();
    await tx.user.update({
      where: { id: member.id },
      data: {
        inviteTokenHash: invite.tokenHash,
        inviteExpiresAt: invite.expiresAt,
        invitedById: actor.id,
        invitedAt: new Date(),
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "invite-reissue",
      summary: `Issued a new invitation link for ${member.name}`,
    });
    return { invitePath: invitePath(invite.token), expiresAt: invite.expiresAt.toISOString() };
  });
}

type Reason = { reason?: string };

export async function deactivateMember(
  actor: Actor,
  memberId: number,
  meta?: RequestMeta,
  { reason }: Reason = {}
) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    // Serialise concurrent deactivations so the last-admin guard cannot be raced.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "permissions" = 'ADMIN' FOR UPDATE`;
    const member = await loadMember(tx, memberId);
    if (memberStatus(member) !== "active") {
      throw errors.conflict("Only active members can be deactivated");
    }
    if (member.id === actor.id) throw errors.conflict("You cannot deactivate your own account");
    if (member.permissions === "ADMIN") {
      const others = await tx.user.count({
        where: { active: true, permissions: "ADMIN", id: { not: member.id } },
      });
      if (others === 0) throw errors.conflict("At least one active admin must remain");
    }
    await tx.user.update({ where: { id: member.id }, data: { active: false } });
    await revokeUserSessions(member.id, "deactivated", {}, tx);
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "deactivate",
      summary: `Deactivated ${member.name}`,
      changes: [{ field: "active", from: "true", to: "false" }],
      reason,
    });
    return { ok: true as const };
  });
}

/**
 * Gives a member another role. The last active administrator keeps theirs, nobody changes their own,
 * and the member's sessions end so the new role applies from their next sign-in.
 */
export async function changeMemberRole(
  actor: Actor,
  memberId: number,
  input: { role: Role; reason: string },
  meta?: RequestMeta
) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    // Serialise with deactivations so the last-admin guard cannot be raced.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "permissions" = 'ADMIN' FOR UPDATE`;
    const member = await loadMember(tx, memberId);
    if (memberStatus(member) === "deactivated") {
      throw errors.conflict("Reactivate the member before changing their role");
    }
    if (member.id === actor.id) throw errors.conflict("You cannot change your own role");
    if (member.permissions === input.role) return { ok: true as const };
    if (member.permissions === "ADMIN") {
      const others = await tx.user.count({
        where: { active: true, permissions: "ADMIN", id: { not: member.id } },
      });
      if (others === 0) throw errors.conflict("At least one active admin must remain");
    }
    await tx.user.update({ where: { id: member.id }, data: { permissions: input.role } });
    await revokeUserSessions(member.id, "role-changed", {}, tx);
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "role",
      summary: `Changed the role of ${member.name} to ${input.role}`,
      changes: [{ field: "access", from: member.permissions, to: input.role }],
      reason: input.reason,
    });
    return { ok: true as const };
  });
}

export async function reactivateMember(actor: Actor, memberId: number, meta?: RequestMeta) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const member = await loadMember(tx, memberId);
    if (memberStatus(member) !== "deactivated") {
      throw errors.conflict("Only deactivated members can be reactivated");
    }
    if (pseudonymNumber(member.name) !== null) {
      throw errors.conflict("This member's personal data was erased; the account cannot return");
    }
    if (!member.passwordHash) {
      throw errors.conflict("This member never set a password — send a new invitation instead");
    }
    await tx.user.update({ where: { id: member.id }, data: { active: true } });
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "reactivate",
      summary: `Reactivated ${member.name}`,
      changes: [{ field: "active", from: "false", to: "true" }],
    });
    return { ok: true as const };
  });
}

/** Revokes a pending invitation. Members who have signed in are deactivated, never deleted. */
export async function revokeInvite(actor: Actor, memberId: number, meta?: RequestMeta) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const member = await loadMember(tx, memberId);
    const status = memberStatus(member);
    if (status !== "invited" && status !== "invite-expired") {
      throw errors.conflict(
        "Only pending invitations can be revoked — deactivate the member instead"
      );
    }
    // The audit entry is written first: it references the user being removed.
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "invite-revoke",
      summary: `Revoked the invitation for ${member.name}`,
    });
    await tx.user.delete({ where: { id: member.id } });
    return { ok: true as const };
  });
}

/**
 * Lost authenticator and recovery codes: an admin clears the member's second factor so they can
 * enrol a new one at next sign-in. Every session of the member ends. Always audited.
 */
export async function resetMemberMfa(
  actor: Actor,
  memberId: number,
  meta?: RequestMeta,
  { reason }: Reason = {}
) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const member = await loadMember(tx, memberId);
    if (!member.active) throw errors.conflict("Only active members can have MFA reset");
    if (member.id === actor.id) throw errors.conflict("Reset your own MFA from your profile");
    await tx.user.update({
      where: { id: member.id },
      data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: member.id } });
    await revokeUserSessions(member.id, "mfa-reset", {}, tx);
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: member.name,
      action: "mfa-reset",
      summary: `Reset two-step verification for ${member.name}`,
      reason,
    });
    return { ok: true as const };
  });
}

/**
 * Erasure on request (PIPEDA / Law 25), for a member who has already been deactivated. The live
 * `User` row loses everything that identifies a person (name, e-mail, initials, password hash, second
 * factor, invitation data, sessions) and gets a stable pseudonym. Audit entries and every regulated
 * record keep the name as it was written at the time: rewriting them would falsify the record, and the
 * database refuses it anyway. Not reversible.
 */
export async function pseudonymiseMember(
  actor: Actor,
  memberId: number,
  input: { reason: string },
  meta?: RequestMeta
) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    // Same lock as deactivation: the admin count cannot change under us.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "permissions" = 'ADMIN' FOR UPDATE`;
    const member = await loadMember(tx, memberId);
    if (member.id === actor.id) throw errors.conflict("You cannot erase your own account");
    if (pseudonymNumber(member.name) !== null) {
      throw errors.conflict("This member's personal data was already erased");
    }
    if (memberStatus(member) !== "deactivated") {
      throw errors.conflict("Only deactivated members can be pseudonymised");
    }
    if (member.permissions === "ADMIN") {
      const others = await tx.user.count({
        where: { active: true, permissions: "ADMIN", id: { not: member.id } },
      });
      if (others === 0) throw errors.conflict("At least one active admin must remain");
    }

    const pseudonym = pseudonymFor(member.id);
    const clash = await tx.user.findFirst({
      where: { name: { equals: pseudonym, mode: "insensitive" }, id: { not: member.id } },
      select: { id: true },
    });
    if (clash) throw errors.conflict("The pseudonym is already in use");

    await tx.session.deleteMany({ where: { userId: member.id } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: member.id } });
    await tx.user.update({
      where: { id: member.id },
      data: {
        name: pseudonym,
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
      },
    });
    // The entry names only the pseudonym: the old name must not be copied into new records.
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: member.id,
      entityLabel: pseudonym,
      action: "pseudonymise",
      summary: `Erased the personal data of a deactivated member; the account is now ${pseudonym}`,
      changes: [
        { field: "name", from: null, to: pseudonym },
        { field: "email", from: null, to: null },
      ],
      reason: input.reason,
    });
    return { ok: true as const, pseudonym };
  });
}

const EXPORT_AUDIT_LIMIT = 100_000;

/**
 * Everything held about one member, for an access request: the profile row (never the password hash,
 * the second-factor secret or the invitation token), their experiments, every session, and every
 * audit entry made by them or about them. Reading personal data is itself recorded.
 */
export async function exportMemberData(actor: Actor, memberId: number, meta?: RequestMeta) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        initials: true,
        email: true,
        permissions: true,
        active: true,
        passwordHash: true,
        passwordChangedAt: true,
        lastLoginAt: true,
        mfaEnabledAt: true,
        inviteTokenHash: true,
        inviteExpiresAt: true,
        invitedById: true,
        invitedAt: true,
        createdAt: true,
        updatedAt: true,
        experiments: {
          select: { role: true, experiment: { select: { id: true, ecode: true, name: true } } },
        },
      },
    });
    if (!user) throw errors.notFound("Member");

    const [sessions, recoveryCodesUnused, auditEntries] = await Promise.all([
      tx.session.findMany({
        where: { userId: memberId },
        orderBy: { id: "asc" },
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
          ip: true,
          userAgent: true,
          requiresMfa: true,
          mfaVerifiedAt: true,
          reauthAt: true,
          revokedAt: true,
          revokedReason: true,
        },
      }),
      tx.mfaRecoveryCode.count({ where: { userId: memberId, usedAt: null } }),
      tx.auditLog.findMany({
        where: { OR: [{ userId: memberId }, { entityType: "member", entityId: memberId }] },
        orderBy: { seq: "asc" },
        take: EXPORT_AUDIT_LIMIT + 1,
        select: {
          seq: true,
          id: true,
          createdAt: true,
          userId: true,
          userName: true,
          userRole: true,
          entityType: true,
          entityId: true,
          entityLabel: true,
          action: true,
          summary: true,
          details: true,
          reason: true,
          requestId: true,
          ip: true,
          userAgent: true,
        },
      }),
    ]);

    const { passwordHash, inviteTokenHash, ...profile } = user;
    const exportedAt = new Date();
    await recordAudit(tx, actor, meta, {
      entityType: "member",
      entityId: user.id,
      entityLabel: user.name,
      action: "export",
      summary: `Exported the personal data held about ${user.name}`,
    });

    return {
      format: "accession-book/member-export@1",
      exportedAt: exportedAt.toISOString(),
      exportedBy: { id: actor.id, name: actor.name },
      profile: {
        ...profile,
        passwordSet: passwordHash !== "",
        invitationPending: inviteTokenHash !== null,
        twoStepVerificationEnabled: user.mfaEnabledAt !== null,
        unusedRecoveryCodes: recoveryCodesUnused,
      },
      sessions,
      auditEntriesTruncated: auditEntries.length > EXPORT_AUDIT_LIMIT,
      auditEntries: auditEntries.slice(0, EXPORT_AUDIT_LIMIT),
    };
  });
}
