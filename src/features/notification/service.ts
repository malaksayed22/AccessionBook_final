import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/server/db";

/** Marks one of the person's notices read; someone else's is left alone. */
export async function markNotificationRead(user: SessionUser, id: number) {
  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(user: SessionUser) {
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

/**
 * Tells a member a task was given to them, inside the transaction that assigns it. Nobody is told
 * about a task they gave themselves. (Administrators already hear of it through the audit entry.)
 */
export async function notifyTaskAssigned(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  taskId: number,
  assigneeId: number | null
) {
  if (assigneeId === null || assigneeId === actor.id) return;
  await tx.notification.create({
    data: { userId: assigneeId, kind: "task_assigned", taskId, actorName: actor.name },
  });
}
