import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { auditEntityHref } from "@/features/audit/links";
import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/server/db";

/** One notice, ready to show: what happened, who did it, and where it leads. */
export type NotificationRow = {
  id: number;
  kind: "activity" | "task_assigned";
  createdAt: Date;
  read: boolean;
  actorName: string | null;
  /** Activity: the audit entry's action, record type, record label and summary. */
  action: string | null;
  entityType: string | null;
  entityLabel: string | null;
  summary: string | null;
  /** Task: its code and title. */
  task: { code: string; title: string } | null;
  /** The page it opens, or null when the record has no page. */
  href: string | null;
};

const SELECT = {
  id: true,
  kind: true,
  createdAt: true,
  readAt: true,
  actorName: true,
  auditLog: {
    select: { action: true, entityType: true, entityId: true, entityLabel: true, summary: true },
  },
  task: { select: { id: true, code: true, title: true } },
} satisfies Prisma.NotificationSelect;

type Row = Prisma.NotificationGetPayload<{ select: typeof SELECT }>;

function toRow(n: Row): NotificationRow {
  const log = n.auditLog;
  return {
    id: n.id,
    kind: n.kind === "task_assigned" ? "task_assigned" : "activity",
    createdAt: n.createdAt,
    read: n.readAt !== null,
    actorName: n.actorName,
    action: log?.action ?? null,
    entityType: log?.entityType ?? null,
    entityLabel: log?.entityLabel ?? null,
    summary: log?.summary ?? null,
    task: n.task ? { code: n.task.code, title: n.task.title } : null,
    href: n.task ? "/inventory/tasks" : log ? auditEntityHref(log.entityType, log.entityId) : null,
  };
}

export async function countUnread(user: SessionUser): Promise<number> {
  return prisma.notification.count({ where: { userId: user.id, readAt: null } });
}

/** A page of the person's own notices, newest first. */
export async function listNotifications(
  user: SessionUser,
  params: { page: number; limit: number; unread?: boolean }
): Promise<{ rows: NotificationRow[]; total: number; unread: number }> {
  const where: Prisma.NotificationWhereInput = {
    userId: user.id,
    ...(params.unread ? { readAt: null } : {}),
  };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: SELECT,
    }),
    prisma.notification.count({ where }),
    countUnread(user),
  ]);
  return { rows: rows.map(toRow), total, unread };
}
