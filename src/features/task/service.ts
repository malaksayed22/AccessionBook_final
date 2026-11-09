import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { TaskStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { startOfZonedDay, zonedDateKey } from "@/lib/lab-time";
import { isReadOnly, seesWholeLab } from "@/lib/roles";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { canEditExperiment, isAdmin, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import { notifyTaskAssigned } from "@/features/notification/service";
import type { CreateTaskInput, TaskCommand } from "./schemas";

/*
 * Tasks plan the lab's work by day: watering a room, taking cuttings, a check on an experiment.
 * A task is about the whole lab, an experiment or one unit, and is assigned to one member (or to
 * nobody yet). Planning on an experiment is for its team and for the roles that work across the
 * lab; a lab-wide task is anyone's to plan. Every change is in the audit trail.
 */

type Tx = Prisma.TransactionClient;

const dayStart = (key: string) => startOfZonedDay(key, env().LAB_TIMEZONE);
const dayKey = (at: Date) => zonedDateKey(at, env().LAB_TIMEZONE);

/** Whether the member may plan work on the experiment (null: the whole lab). */
async function canPlan(tx: Tx, user: SessionUser, experimentId: number | null) {
  if (isReadOnly(user)) return false;
  if (experimentId === null || seesWholeLab(user)) return true;
  return canEditExperiment(tx, user, experimentId);
}

/** The assignee must be an active member who can see what the task is about. */
async function assertAssignee(tx: Tx, assigneeId: number, experimentId: number | null) {
  const assignee = await tx.user.findUnique({
    where: { id: assigneeId },
    select: { active: true, permissions: true },
  });
  if (!assignee?.active) {
    throw errors.validation("Choose an active member", { fields: ["assigneeId"] });
  }
  if (assignee.permissions === "INSPECTOR") {
    throw errors.validation("An inspector cannot be given work", { fields: ["assigneeId"] });
  }
  if (experimentId === null || assignee.permissions !== "REGULAR") return;
  const member = await tx.experimentMember.findUnique({
    where: { experimentId_userId: { experimentId, userId: assigneeId } },
    select: { userId: true },
  });
  if (!member) {
    throw errors.validation("Assign a member of the experiment's team", {
      fields: ["assigneeId"],
      reason: "assigneeNotOnTeam",
    });
  }
}

export async function createTask(actor: SessionUser, input: CreateTaskInput, meta?: RequestMeta) {
  return prisma.$transaction(async (tx) => {
    let experimentId = input.experimentId ?? null;
    let unitName: string | null = null;
    if (input.unitId) {
      const unit = await tx.biologicalUnit.findFirst({
        where: { AND: [unitReadScope(actor), { id: input.unitId }] },
        select: { name: true, experimentId: true },
      });
      if (!unit) throw errors.notFound("Unit");
      if (experimentId !== null && unit.experimentId !== experimentId) {
        throw errors.validation("The unit belongs to another experiment", { fields: ["unitId"] });
      }
      experimentId = unit.experimentId;
      unitName = unit.name;
    }
    if (!(await canPlan(tx, actor, experimentId))) {
      throw errors.forbidden("Only the experiment's team can plan its work");
    }
    if (input.assigneeId) await assertAssignee(tx, input.assigneeId, experimentId);

    const task = await tx.task.create({
      data: {
        title: input.title,
        details: input.details ?? null,
        dueDate: dayStart(input.dueDate),
        experimentId,
        unitId: input.unitId ?? null,
        assigneeId: input.assigneeId ?? null,
        createdById: actor.id,
      },
      select: { id: true, title: true },
    });
    await notifyTaskAssigned(tx, actor, task.id, input.assigneeId ?? null);
    await recordAudit(tx, actor, meta, {
      entityType: "task",
      entityId: task.id,
      entityLabel: task.title,
      action: "create",
      summary: `Planned "${task.title}" for ${input.dueDate}${unitName ? ` on ${unitName}` : ""}`,
    });
    return task;
  });
}

/** Completes, reopens, cancels, reschedules or reassigns a task. */
export async function updateTask(
  actor: SessionUser,
  id: number,
  command: TaskCommand,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id } });
    if (!task) throw errors.notFound("Task");
    const own = task.assigneeId === actor.id || task.createdById === actor.id;
    if (
      isReadOnly(actor) ||
      !(own || isAdmin(actor) || (await canPlan(tx, actor, task.experimentId)))
    ) {
      throw errors.forbidden("Only the task's assignee or the experiment's team can change it");
    }

    const now = new Date();
    let data: Prisma.TaskUncheckedUpdateInput;
    let summary: string;
    let reason: string | undefined;
    switch (command.action) {
      case "complete":
        if (task.status !== TaskStatus.OPEN) throw errors.conflict("Only an open task can be done");
        data = { status: TaskStatus.DONE, completedAt: now, completedById: actor.id };
        summary = `Done: "${task.title}"`;
        break;
      case "reopen":
        if (task.status === TaskStatus.OPEN) throw errors.conflict("The task is already open");
        data = { status: TaskStatus.OPEN, completedAt: null, completedById: null };
        summary = `Reopened "${task.title}"`;
        break;
      case "cancel":
        if (task.status !== TaskStatus.OPEN) {
          throw errors.conflict("Only an open task can be cancelled");
        }
        data = { status: TaskStatus.CANCELLED, completedAt: now, completedById: actor.id };
        summary = `Cancelled "${task.title}"`;
        reason = command.reason;
        break;
      case "reschedule":
        data = { dueDate: dayStart(command.dueDate) };
        summary = `Moved "${task.title}" to ${command.dueDate}`;
        break;
      case "assign":
        if (command.assigneeId !== null) {
          await assertAssignee(tx, command.assigneeId, task.experimentId);
        }
        data = { assigneeId: command.assigneeId };
        summary = `Reassigned "${task.title}"`;
        break;
    }

    const updated = await tx.task.update({ where: { id }, data, select: TASK_FIELDS });
    if (command.action === "assign" && updated.assigneeId !== task.assigneeId) {
      await notifyTaskAssigned(tx, actor, id, updated.assigneeId);
    }
    await recordAudit(tx, actor, meta, {
      entityType: "task",
      entityId: id,
      entityLabel: task.title,
      action: command.action,
      summary,
      reason,
      changes: buildChanges([
        { field: "status", from: task.status, to: updated.status },
        { field: "dueDate", from: dayKey(task.dueDate), to: dayKey(updated.dueDate) },
        { field: "assigneeId", from: task.assigneeId, to: updated.assigneeId },
      ]),
    });
    return updated;
  });
}

const TASK_FIELDS = { id: true, status: true, dueDate: true, assigneeId: true } as const;
