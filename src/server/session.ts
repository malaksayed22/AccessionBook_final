import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { randomToken, sha256 } from "./crypto";
import { prisma } from "./db";
import { env } from "./env";
import type { Role } from "@/lib/roles";

/**
 * Database-backed sessions. The browser holds a random 256-bit token; the database holds only its
 * SHA-256, so a leaked database (or backup) cannot be replayed as logins. A session ends when it
 * has been idle too long, when its absolute lifetime is over, or when it is revoked (sign-out,
 * password change, deactivation, role change).
 *
 * This module is cookie-free so it can be tested directly; `@/lib/auth` binds it to the request.
 */

/**
 * - `active`: fully usable.
 * - `mfa-required`: password accepted, second factor not yet given.
 * - `mfa-enrolment-required`: the role demands MFA and the account has none yet.
 */
export type SessionState = "active" | "mfa-required" | "mfa-enrolment-required";

export type ResolvedSession = {
  id: number;
  state: SessionState;
  createdAt: Date;
  expiresAt: Date;
  mfaVerifiedAt: Date | null;
  reauthAt: Date | null;
  user: {
    id: number;
    name: string;
    permissions: Role;
    mfaEnabled: boolean;
  };
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** `lastSeenAt` is only rewritten when it is this stale, so reads do not become writes. */
const TOUCH_INTERVAL = MINUTE;

export type NewSession = {
  userId: number;
  ip?: string | null;
  userAgent?: string | null;
  /** True once the password step is done and the account has MFA still to verify. */
  requiresMfa: boolean;
};

export async function createSession(input: NewSession, now = new Date()) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + env().SESSION_ABSOLUTE_HOURS * HOUR);
  const row = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: sha256(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: input.ip?.slice(0, 64),
      userAgent: input.userAgent?.slice(0, 300),
      requiresMfa: input.requiresMfa,
      reauthAt: input.requiresMfa ? null : now,
    },
    select: { id: true },
  });
  return { id: row.id, token, expiresAt };
}

function stateOf(
  user: { permissions: Role; mfaEnabledAt: Date | null },
  mfaVerifiedAt: Date | null
): SessionState {
  if (user.mfaEnabledAt) return mfaVerifiedAt ? "active" : "mfa-required";
  if (user.permissions === "ADMIN" && env().REQUIRE_ADMIN_MFA) return "mfa-enrolment-required";
  return "active";
}

/** Looks a raw cookie token up; returns null for unknown, expired, idle or revoked sessions. */
export async function resolveSession(
  token: string | undefined,
  now = new Date()
): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        select: { id: true, name: true, permissions: true, active: true, mfaEnabledAt: true },
      },
    },
  });
  if (!row || row.revokedAt || !row.user.active) return null;
  if (row.expiresAt <= now) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > env().SESSION_IDLE_MINUTES * MINUTE) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL) {
    await prisma.session.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { lastSeenAt: now },
    });
  }

  return {
    id: row.id,
    state: stateOf(row.user, row.mfaVerifiedAt),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    mfaVerifiedAt: row.mfaVerifiedAt,
    reauthAt: row.reauthAt,
    user: {
      id: row.user.id,
      name: row.user.name,
      permissions: row.user.permissions,
      mfaEnabled: row.user.mfaEnabledAt !== null,
    },
  };
}

type Client = Prisma.TransactionClient | typeof prisma;

export async function revokeSession(id: number, reason: string, db: Client = prisma) {
  await db.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Ends every live session of a user, optionally sparing the one performing the action. */
export async function revokeUserSessions(
  userId: number,
  reason: string,
  options: { exceptSessionId?: number } = {},
  db: Client = prisma
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export async function revokeSessionByToken(token: string, reason: string) {
  await prisma.session.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function markMfaVerified(sessionId: number, now = new Date()) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { mfaVerifiedAt: now, reauthAt: now },
  });
}

export async function markReauthenticated(sessionId: number, now = new Date()) {
  await prisma.session.update({ where: { id: sessionId }, data: { reauthAt: now } });
}

/** Is a confirmation recent enough for a sensitive action? Always true when re-auth is off. */
export function isRecentlyConfirmed(session: Pick<ResolvedSession, "reauthAt">, now = new Date()) {
  if (!env().REQUIRE_REAUTH) return true;
  return (
    session.reauthAt !== null &&
    now.getTime() - session.reauthAt.getTime() <= env().REAUTH_WINDOW_MINUTES * MINUTE
  );
}

export async function listActiveSessions(userId: number, now = new Date()) {
  const idleCutoff = new Date(now.getTime() - env().SESSION_IDLE_MINUTES * MINUTE);
  return prisma.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
      lastSeenAt: { gt: idleCutoff },
    },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true },
  });
}

/** Housekeeping: dead sessions are kept for 30 days (investigations), then dropped. */
export async function purgeDeadSessions(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 24 * HOUR);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return result.count;
}
