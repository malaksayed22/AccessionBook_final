import "server-only";
import { hashInviteToken, memberStatus } from "@/lib/invites";
import { prisma } from "@/server/db";

/** What the invitation page shows. `null` when the link is unknown, used, revoked or expired. */
export async function getInviteLanding(token: string) {
  const invitee = await prisma.user.findUnique({
    where: { inviteTokenHash: hashInviteToken(token) },
    select: {
      name: true,
      permissions: true,
      active: true,
      inviteTokenHash: true,
      inviteExpiresAt: true,
    },
  });
  if (!invitee || memberStatus(invitee) !== "invited") return null;
  return { name: invitee.name, permissions: invitee.permissions };
}

/** The signed-in user's own account facts, for the profile page. */
export async function getProfileSummary(userId: number) {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      initials: true,
      email: true,
      createdAt: true,
      lastLoginAt: true,
      passwordChangedAt: true,
      mfaEnabledAt: true,
      _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
    },
  });
  return {
    initials: record?.initials ?? null,
    email: record?.email ?? null,
    createdAt: record?.createdAt ?? null,
    lastLoginAt: record?.lastLoginAt ?? null,
    passwordChangedAt: record?.passwordChangedAt ?? null,
    mfaEnabled: record?.mfaEnabledAt != null,
    recoveryCodesLeft: record?._count.recoveryCodes ?? 0,
  };
}
