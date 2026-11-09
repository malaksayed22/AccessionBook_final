import "server-only";
import { hashInviteToken } from "@/lib/invites";
import {
  burnPasswordTime,
  hashPassword,
  passwordIssueText,
  passwordNeedsRehash,
  passwordPolicyIssue,
  verifyPassword,
} from "@/lib/password";
import { recordAuthEvent, type RequestMeta } from "@/server/audit";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import * as rateLimit from "@/server/rate-limit";
import {
  createSession,
  markReauthenticated,
  revokeSession,
  revokeSessionByToken,
  revokeUserSessions,
} from "@/server/session";
import type { Role } from "@/lib/roles";

/**
 * Sign-in, invitation acceptance, password changes and re-authentication. Every outcome is audited;
 * failures never reveal whether a username exists.
 */
const IP_LIMIT = { limit: 30, windowSeconds: 15 * 60 };
const ACCOUNT_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
const PROFILE_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
const INVITE_IP_LIMIT = { limit: 20, windowSeconds: 15 * 60 };

function assertPasswordAcceptable(password: string, username: string) {
  const issue = passwordPolicyIssue(password, username);
  if (issue) throw errors.passwordPolicy(issue, passwordIssueText(issue));
}

/** "offer-enrol": two-step verification is not set up; it is offered and may be skipped. */
export type NextStep = "done" | "mfa" | "enrol" | "offer-enrol";

function nextStepFor(user: { permissions: string; mfaEnabledAt: Date | null }): NextStep {
  if (user.mfaEnabledAt) return "mfa";
  if (user.permissions === "ADMIN" && env().REQUIRE_ADMIN_MFA) return "enrol";
  return "offer-enrol";
}

const foldName = (name: string) => name.trim().toLowerCase().normalize("NFKC");

export type SignInResult = {
  user: { id: number; name: string; permissions: Role };
  next: NextStep;
  token: string;
  expiresAt: Date;
};

export async function signIn(
  input: { name: string; password: string },
  options: { meta?: RequestMeta; previousToken?: string } = {}
): Promise<SignInResult> {
  const { meta } = options;
  // The sign-in field takes the member's e-mail address or their name.
  const name = input.name.trim();
  const ip = meta?.ip ?? "unknown";
  await rateLimit.enforce(`login:ip:${ip}`, IP_LIMIT);

  const user = await prisma.user.findFirst({
    where: {
      active: true,
      ...(name.includes("@")
        ? { email: { equals: name, mode: "insensitive" } }
        : { name: { equals: name, mode: "insensitive" } }),
    },
    select: {
      id: true,
      name: true,
      permissions: true,
      passwordHash: true,
      mfaEnabledAt: true,
    },
  });

  // One failure counter per account, whichever identifier was typed, so the e-mail and the name do
  // not each get their own allowance of guesses.
  const accountKey = `login:acct:${foldName(user?.name ?? name)}`;
  const locked = await rateLimit.peek(accountKey, ACCOUNT_LIMIT.limit);
  if (locked.exceeded) throw rateLimit.rateLimited(locked.resetAt);

  // Always do one password verification's worth of work, whether or not the account exists.
  const valid = user
    ? await verifyPassword(input.password, user.passwordHash)
    : (await burnPasswordTime(input.password), false);

  if (!user || !valid) {
    const failure = await rateLimit.hit(accountKey, ACCOUNT_LIMIT);
    if (user) {
      const lockedNow = failure.count === ACCOUNT_LIMIT.limit;
      await recordAuthEvent({
        ...meta,
        userId: user.id,
        userName: user.name,
        role: user.permissions,
        action: lockedNow ? "login-locked" : "login-failed",
        summary: lockedNow
          ? `Sign-in for ${user.name} locked for 15 minutes after repeated failures`
          : `Failed sign-in for ${user.name}`,
      });
    }
    throw errors.invalidCredentials();
  }

  await rateLimit.clear(accountKey);

  if (options.previousToken) await revokeSessionByToken(options.previousToken, "replaced");

  const session = await createSession({
    userId: user.id,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requiresMfa: user.mfaEnabledAt !== null,
  });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      ...(passwordNeedsRehash(user.passwordHash)
        ? { passwordHash: await hashPassword(input.password) }
        : {}),
    },
  });
  await recordAuthEvent({
    ...meta,
    userId: user.id,
    userName: user.name,
    role: user.permissions,
    action: "login",
    summary: `${user.name} signed in`,
  });
  return {
    user: { id: user.id, name: user.name, permissions: user.permissions },
    next: nextStepFor(user),
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export async function signOut(
  session: { id: number; user: { id: number; name: string; permissions: string } },
  meta?: RequestMeta
) {
  await revokeSession(session.id, "signed-out");
  await recordAuthEvent({
    ...meta,
    userId: session.user.id,
    userName: session.user.name,
    role: session.user.permissions,
    action: "logout",
    summary: `${session.user.name} signed out`,
  });
}

/** The invitee proves possession of the one-time link and chooses a password. */
export async function acceptInvite(
  input: { token: string; password: string },
  meta?: RequestMeta
): Promise<SignInResult> {
  await rateLimit.enforce(`invite:ip:${meta?.ip ?? "unknown"}`, INVITE_IP_LIMIT);

  const tokenHash = hashInviteToken(input.token);
  const invitee = await prisma.user.findUnique({
    where: { inviteTokenHash: tokenHash },
    select: {
      id: true,
      name: true,
      permissions: true,
      active: true,
      inviteExpiresAt: true,
      mfaEnabledAt: true,
    },
  });
  if (
    !invitee ||
    invitee.active ||
    !invitee.inviteExpiresAt ||
    invitee.inviteExpiresAt.getTime() <= Date.now()
  ) {
    throw errors.inviteInvalid();
  }
  assertPasswordAcceptable(input.password, invitee.name);

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    // Conditioning on the hash makes the link single-use even if two requests race.
    const claimed = await tx.user.updateMany({
      where: { id: invitee.id, inviteTokenHash: tokenHash, active: false },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        lastLoginAt: new Date(),
        active: true,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    if (claimed.count !== 1) throw errors.inviteInvalid();
    await recordAuthEvent(
      {
        ...meta,
        userId: invitee.id,
        userName: invitee.name,
        role: invitee.permissions,
        action: "invite-accept",
        summary: `${invitee.name} accepted their invitation and set a password`,
      },
      tx
    );
  });

  const session = await createSession({
    userId: invitee.id,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requiresMfa: false,
  });
  return {
    user: { id: invitee.id, name: invitee.name, permissions: invitee.permissions },
    next: nextStepFor(invitee),
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

type Self = { id: number; name: string; permissions: Role };

/** Confirms the password for the current user, counting failures against a per-account limit. */
async function confirmPassword(self: Self, password: string, meta?: RequestMeta) {
  const key = `profile:${self.id}`;
  const state = await rateLimit.peek(key, PROFILE_LIMIT.limit);
  if (state.exceeded) throw rateLimit.rateLimited(state.resetAt);
  const row = await prisma.user.findUnique({
    where: { id: self.id },
    select: { passwordHash: true },
  });
  if (!row || !(await verifyPassword(password, row.passwordHash))) {
    await rateLimit.hit(key, PROFILE_LIMIT);
    await recordAuthEvent({
      ...meta,
      userId: self.id,
      userName: self.name,
      role: self.permissions,
      action: "password-confirm-failed",
      summary: `${self.name} entered a wrong password when confirming a change`,
    });
    throw errors.incorrectPassword();
  }
  await rateLimit.clear(key);
}

/** "Please confirm your password" before a destructive action. Valid for REAUTH_WINDOW_MINUTES. */
export async function reauthenticate(
  self: Self,
  sessionId: number,
  password: string,
  meta?: RequestMeta
) {
  await confirmPassword(self, password, meta);
  await markReauthenticated(sessionId);
  await recordAuthEvent({
    ...meta,
    userId: self.id,
    userName: self.name,
    role: self.permissions,
    action: "reauth",
    summary: `${self.name} confirmed their password for a sensitive action`,
  });
}

export type ProfileInput = {
  currentPassword: string;
  name?: string;
  initials?: string;
  newPassword?: string;
};

export async function updateProfile(
  self: Self,
  sessionId: number,
  input: ProfileInput,
  meta?: RequestMeta
) {
  await confirmPassword(self, input.currentPassword, meta);

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: self.id },
    select: { name: true, initials: true, permissions: true },
  });
  const data: {
    name?: string;
    initials?: string;
    passwordHash?: string;
    passwordChangedAt?: Date;
  } = {};

  const wantedName = input.name?.trim();
  if (wantedName && wantedName !== current.name) {
    const taken = await prisma.user.findFirst({
      where: { name: { equals: wantedName, mode: "insensitive" }, id: { not: self.id } },
      select: { id: true },
    });
    // Deliberately vague: this must not be a way to test which names exist.
    if (taken) throw errors.usernameUnavailable();
    data.name = wantedName;
  }

  if (input.initials !== undefined) {
    const cleaned = input.initials
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase()
      .slice(0, 4);
    if (cleaned && cleaned.length < 2) throw errors.initialsInvalid();
    if (cleaned && cleaned !== current.initials) data.initials = cleaned;
  }

  if (input.newPassword) {
    assertPasswordAcceptable(input.newPassword, data.name ?? current.name);
    data.passwordHash = await hashPassword(input.newPassword);
    data.passwordChangedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return {
      id: self.id,
      name: current.name,
      permissions: current.permissions,
      initials: current.initials,
      unchanged: true as const,
    };
  }

  const updated = await prisma.user.update({
    where: { id: self.id },
    data,
    select: { id: true, name: true, permissions: true, initials: true },
  });
  if (data.passwordHash) {
    // A changed password ends every other session: whoever held the old one is signed out.
    const ended = await revokeUserSessions(self.id, "password-changed", {
      exceptSessionId: sessionId,
    });
    await recordAuthEvent({
      ...meta,
      userId: self.id,
      userName: updated.name,
      role: self.permissions,
      action: "password-change",
      summary: `${updated.name} changed their password (${ended} other session${ended === 1 ? "" : "s"} ended)`,
    });
  }
  if (data.name || data.initials) {
    await recordAuthEvent({
      ...meta,
      userId: self.id,
      userName: updated.name,
      role: self.permissions,
      action: "profile-update",
      summary: `${updated.name} updated their profile`,
    });
  }
  return { ...updated, unchanged: false as const };
}

/** Signs the user out everywhere except the device they are using. Returns how many sessions ended. */
export async function revokeOtherSessions(
  self: Self,
  currentSessionId: number,
  meta?: RequestMeta
) {
  const ended = await revokeUserSessions(self.id, "revoked-by-user", {
    exceptSessionId: currentSessionId,
  });
  if (ended > 0) {
    await recordAuthEvent({
      ...meta,
      userId: self.id,
      userName: self.name,
      role: self.permissions,
      action: "sessions-revoked",
      summary: `${self.name} ended ${ended} other session${ended === 1 ? "" : "s"}`,
    });
  }
  return { ended };
}

/** Ends one of the user's own sessions. A session of anyone else reads as not found. */
export async function revokeOwnSession(self: Self, sessionId: number, meta?: RequestMeta) {
  const target = await prisma.session.findFirst({
    where: { id: sessionId, userId: self.id, revokedAt: null },
    select: { id: true },
  });
  if (!target) throw errors.notFound("Session");
  await revokeSession(target.id, "revoked-by-user");
  await recordAuthEvent({
    ...meta,
    userId: self.id,
    userName: self.name,
    role: self.permissions,
    action: "session-revoked",
    summary: `${self.name} ended one of their sessions`,
  });
}
