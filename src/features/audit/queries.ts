import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { parseAuditChanges, type AuditChange } from "@/lib/audit-changes";
import type { SessionUser } from "@/lib/auth";
import { parseDateRange, periodFilter } from "@/lib/reports/date-range";
import { likeEscape } from "@/lib/search-text";
import { assertCanReadCompliance } from "@/server/authz";
import { prisma } from "@/server/db";
import { classifyChainFailure, type ChainFailureKind } from "./chain";

/*
 * Reads of the audit trail. The trail is administrator-only: every function here asserts it, so a
 * page or route that forgets the check still cannot leak who did what.
 */

export const AUDIT_ORDERS = ["asc", "desc"] as const;

export type AuditListParams = {
  /** Free text over summary, record, actor, reason, request id, action; a whole number also matches the sequence. */
  q?: string;
  actorId?: number;
  entityType?: string;
  action?: string;
  /** `YYYY-MM-DD` in the laboratory time zone, inclusive. */
  from?: string;
  to?: string;
  /** By position in the hash chain, which is also chronological order. */
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type AuditEntryRow = {
  id: number;
  seq: number;
  createdAt: Date;
  actorId: number | null;
  actorName: string;
  actorRole: string;
  /**
   * A failed sign-in: written against the account that was tried, but nobody was signed in, so the
   * screens say "not signed in" rather than naming the account holder as the one who acted.
   */
  attempt: boolean;
  entityType: string;
  entityId: number;
  entityLabel: string;
  action: string;
  summary: string;
  changes: AuditChange[];
  reason: string | null;
  requestId: string | null;
};

const rowSelect = {
  id: true,
  seq: true,
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
} satisfies Prisma.AuditLogSelect;

type AuditRecord = Prisma.AuditLogGetPayload<{ select: typeof rowSelect }>;

const ATTEMPTS: ReadonlySet<string> = new Set(["login-failed", "login-locked"]);

function toRow(entry: AuditRecord): AuditEntryRow {
  const attempt = ATTEMPTS.has(entry.action);
  return {
    id: entry.id,
    seq: entry.seq,
    createdAt: entry.createdAt,
    actorId: attempt ? null : entry.userId,
    actorName: entry.userName,
    actorRole: entry.userRole,
    attempt,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    action: entry.action,
    summary: entry.summary,
    changes: parseAuditChanges(entry.details),
    reason: entry.reason,
    requestId: entry.requestId,
  };
}

function whereFor(params: Omit<AuditListParams, "order" | "page" | "limit">) {
  const needle = params.q?.trim();
  const escaped = needle ? likeEscape(needle) : undefined;
  const contains = (field: string) =>
    ({ [field]: { contains: escaped, mode: "insensitive" } }) as Prisma.AuditLogWhereInput;
  const sequence = needle && /^\d{1,9}$/.test(needle) ? Number(needle) : undefined;
  const createdAt = periodFilter(parseDateRange(params.from, params.to));

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      params.actorId ? { userId: params.actorId } : {},
      params.entityType ? { entityType: params.entityType } : {},
      params.action ? { action: params.action } : {},
      createdAt ? { createdAt } : {},
      escaped
        ? {
            OR: [
              contains("summary"),
              contains("entityLabel"),
              contains("userName"),
              contains("reason"),
              contains("requestId"),
              contains("action"),
              ...(sequence !== undefined ? [{ seq: sequence }] : []),
            ],
          }
        : {},
    ],
  };
  return where;
}

/** One page of the audit trail, filtered, searched, ordered and paged by the database. */
export async function listAuditEntries(
  user: SessionUser,
  params: AuditListParams
): Promise<{ rows: AuditEntryRow[]; total: number }> {
  assertCanReadCompliance(user);
  const where = whereFor(params);
  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { seq: params.order },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: rowSelect,
    }),
  ]);
  return { rows: entries.map(toRow), total };
}

/** The newest entries, for the dashboard feed. */
export async function listRecentAuditEntries(
  user: SessionUser,
  limit = 8
): Promise<AuditEntryRow[]> {
  assertCanReadCompliance(user);
  const entries = await prisma.auditLog.findMany({
    orderBy: { seq: "desc" },
    take: limit,
    select: rowSelect,
  });
  return entries.map(toRow);
}

export type AuditFilterOptions = {
  actors: Array<{ id: number; name: string }>;
  entityTypes: string[];
  actions: string[];
};

/** What the filter selects offer: only values that exist in the trail. */
export async function getAuditFilterOptions(user: SessionUser): Promise<AuditFilterOptions> {
  assertCanReadCompliance(user);
  const [actors, entityTypes, actions] = await Promise.all([
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.auditLog.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } }),
    prisma.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
  ]);
  return {
    actors,
    entityTypes: entityTypes.map((row) => row.entityType),
    actions: actions.map((row) => row.action),
  };
}

// --- Chain verification ----------------------------------------------------------------------

export type ChainStatus = {
  /** True when every entry links to its predecessor and matches its own hash. */
  intact: boolean;
  /** Entries examined (the whole trail). */
  entries: number;
  /** Highest sequence number, or null when the trail is empty. */
  lastSeq: number | null;
  /** The first broken position, when `intact` is false. */
  firstBroken: { seq: number; kind: ChainFailureKind; detail: string } | null;
  verifiedAt: Date;
};

/**
 * Runs `audit_verify_chain()` in the database over the whole trail. It detects an entry altered,
 * or any entry removed from the middle of history. It cannot detect entries removed from the very
 * end: that needs the latest hash anchored outside the database (see docs/architecture.md).
 */
export async function verifyAuditChain(user: SessionUser): Promise<ChainStatus> {
  assertCanReadCompliance(user);
  const [broken, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ broken_seq: number; reason: string }>>`
      SELECT * FROM audit_verify_chain()`,
    prisma.auditLog.aggregate({ _count: { _all: true }, _max: { seq: true } }),
  ]);
  const first = broken[0];
  return {
    intact: first === undefined,
    entries: totals._count._all,
    lastSeq: totals._max.seq,
    firstBroken: first
      ? {
          seq: first.broken_seq,
          kind: classifyChainFailure(first.reason),
          detail: first.reason,
        }
      : null,
    verifiedAt: new Date(),
  };
}
