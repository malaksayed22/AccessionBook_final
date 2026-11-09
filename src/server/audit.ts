import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import type { AuditChange } from "@/lib/audit-changes";

/** Where a request came from; recorded with every audit entry it causes. */
export type RequestMeta = {
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditEntry = {
  entityType: string;
  entityId: number;
  entityLabel: string;
  action: string;
  summary: string;
  changes?: AuditChange[];
  /** Why the change was made; required for sensitive actions in later phases. */
  reason?: string;
} & RequestMeta;

/**
 * Appends an audit entry. Pass the surrounding transaction client as `tx` so the
 * entry commits atomically with the change it describes; without it the entry is a
 * separate write (legacy call sites, migrated in phase P2).
 *
 * The database assigns `seq`, `prevHash` and `hash` and rejects any later UPDATE or
 * DELETE (see the "integrity" migration), so this is the only way history is written.
 */
export async function logMemberActivity(
  user: SessionUser,
  data: AuditEntry,
  tx: Prisma.TransactionClient = prisma
) {
  await tx.auditLog.create({
    data: {
      userId: user.id,
      userName: user.name,
      userRole: user.permissions,
      entityType: data.entityType,
      entityId: data.entityId,
      entityLabel: data.entityLabel,
      action: data.action,
      summary: data.summary,
      details: data.changes?.length ? (data.changes as Prisma.InputJsonValue) : undefined,
      reason: data.reason,
      requestId: data.requestId,
      ip: data.ip ?? undefined,
      userAgent: data.userAgent ?? undefined,
    },
  });
}

/** Appends an audit entry inside `tx`, stamping it with where the request came from. */
export function recordAudit(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  meta: RequestMeta | undefined,
  entry: AuditEntry
) {
  return logMemberActivity(actor, { ...entry, ...meta }, tx);
}

export function buildChanges(
  pairs: Array<{ field: string; from: unknown; to: unknown }>
): AuditChange[] {
  return pairs
    .filter((p) => String(p.from ?? "") !== String(p.to ?? ""))
    .map((p) => ({
      field: p.field,
      from: p.from == null ? null : String(p.from),
      to: p.to == null ? null : String(p.to),
    }));
}

export type AuthEvent = {
  /** The account concerned, when it exists. Unknown names are recorded as text only. */
  userId?: number | null;
  /** Attempted or actual username (client-supplied for failures: truncated, never trusted). */
  userName: string;
  role?: string;
  action: string;
  summary: string;
  reason?: string;
} & RequestMeta;

/**
 * Authentication events (sign-in, failure, lockout, MFA, password change). These have no
 * authenticated actor, so the actor is the account concerned, or none.
 */
export async function recordAuthEvent(event: AuthEvent, tx: Prisma.TransactionClient = prisma) {
  await tx.auditLog.create({
    data: {
      userId: event.userId ?? null,
      userName: event.userName.slice(0, 120),
      userRole: event.role ?? (event.userId ? "USER" : "ANONYMOUS"),
      entityType: "auth",
      entityId: event.userId ?? 0,
      entityLabel: event.userName.slice(0, 120),
      action: event.action,
      summary: event.summary,
      reason: event.reason,
      requestId: event.requestId,
      ip: event.ip ?? undefined,
      userAgent: event.userAgent?.slice(0, 300) ?? undefined,
    },
  });
}
