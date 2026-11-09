import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { startOfZonedDay, zonedDateKey } from "@/lib/lab-time";
import { isReadOnly, seesWholeLab } from "@/lib/roles";
import { experimentReadScope, isAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

export const TASK_VIEWS = ["mine", "all"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
export const TASK_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;

export type TaskRow = {
  id: number;
  /** Short code made by the database. */
  code: string;
  title: string;
  details: string | null;
  /** The day it is due, `YYYY-MM-DD` in the laboratory's time zone. */
  due: string;
  status: TaskStatus;
  /** Still open after its day. */
  overdue: boolean;
  experiment: { id: number; ecode: string } | null;
  unit: { id: number; name: string } | null;
  assignee: { id: number; name: string } | null;
  createdBy: string;
  /** Whether the reader may complete, cancel or move it. */
  canChange: boolean;
};

/**
 * The tasks a member sees: those of their experiments, those given to them or planned by them, and
 * the lab-wide ones. The roles that see the whole lab see every task.
 */
export function taskReadScope(user: SessionUser): Prisma.TaskWhereInput {
  if (seesWholeLab(user)) return {};
  return {
    OR: [
      { assigneeId: user.id },
      { createdById: user.id },
      { experimentId: null },
      { experiment: { is: experimentReadScope(user) } },
    ],
  };
}

const SELECT = {
  id: true,
  code: true,
  title: true,
  details: true,
  dueDate: true,
  status: true,
  experimentId: true,
  assigneeId: true,
  createdById: true,
  experiment: { select: { id: true, ecode: true } },
  unit: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.TaskSelect;

type Stored = Prisma.TaskGetPayload<{ select: typeof SELECT }>;

/** Turns stored tasks into rows, deciding for each whether the reader may change it. */
async function toRows(user: SessionUser, tasks: Stored[]): Promise<TaskRow[]> {
  const zone = env().LAB_TIMEZONE;
  const today = zonedDateKey(new Date(), zone);
  const team =
    seesWholeLab(user) || isReadOnly(user)
      ? null
      : new Set(
          (
            await prisma.experimentMember.findMany({
              where: { userId: user.id },
              select: { experimentId: true },
            })
          ).map((m) => m.experimentId)
        );
  return tasks.map((task) => {
    const due = zonedDateKey(task.dueDate, zone);
    const own = task.assigneeId === user.id || task.createdById === user.id;
    const plans =
      !isReadOnly(user) &&
      (seesWholeLab(user) || task.experimentId === null || team?.has(task.experimentId) === true);
    return {
      id: task.id,
      code: task.code,
      title: task.title,
      details: task.details,
      due,
      status: task.status,
      overdue: task.status === "OPEN" && due < today,
      experiment: task.experiment,
      unit: task.unit,
      assignee: task.assignee,
      createdBy: task.createdBy.name,
      canChange: !isReadOnly(user) && (own || isAdmin(user) || plans),
    };
  });
}

export type TaskListParams = {
  view: TaskView;
  status?: TaskStatus;
  experimentId?: number;
  /** Due on or after this day, before the day after `to` (`YYYY-MM-DD`). */
  from?: string;
  to?: string;
  limit?: number;
};

/** Tasks by due day, the earliest first. */
export async function listTasks(user: SessionUser, params: TaskListParams): Promise<TaskRow[]> {
  const zone = env().LAB_TIMEZONE;
  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        taskReadScope(user),
        params.view === "mine" ? { assigneeId: user.id } : {},
        params.status ? { status: params.status } : {},
        params.experimentId ? { experimentId: params.experimentId } : {},
        params.from ? { dueDate: { gte: startOfZonedDay(params.from, zone) } } : {},
        params.to ? { dueDate: { lte: startOfZonedDay(params.to, zone) } } : {},
      ],
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: params.limit ?? 500,
    select: SELECT,
  });
  return toRows(user, tasks);
}

export type CalendarDay = { key: string; inMonth: boolean; today: boolean; tasks: TaskRow[] };

/** `2026-11` → the weeks (Sunday first) that show November 2026, each day with its tasks. */
export async function getTaskCalendar(
  user: SessionUser,
  month: string,
  view: TaskView
): Promise<{ month: string; previous: string; next: string; weeks: CalendarDay[][] }> {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(Date.UTC(year, monthIndex, 0));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const key = (date: Date) => date.toISOString().slice(0, 10);

  const tasks = await listTasks(user, { view, from: key(start), to: key(end), limit: 1000 });
  const byDay = new Map<string, TaskRow[]>();
  for (const task of tasks) byDay.set(task.due, [...(byDay.get(task.due) ?? []), task]);

  const today = zonedDateKey(new Date(), env().LAB_TIMEZONE);
  const weeks: CalendarDay[][] = [];
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() === 0) weeks.push([]);
    const dayKey = key(day);
    weeks.at(-1)!.push({
      key: dayKey,
      inMonth: day.getUTCMonth() === monthIndex - 1,
      today: dayKey === today,
      tasks: byDay.get(dayKey) ?? [],
    });
  }
  const shift = (by: number) => key(new Date(Date.UTC(year, monthIndex - 1 + by, 1))).slice(0, 7);
  return { month, previous: shift(-1), next: shift(1), weeks };
}

/** Open tasks given to the member, overdue and due today counted apart: the dashboard's card. */
export async function getMyTaskCounts(user: SessionUser) {
  const zone = env().LAB_TIMEZONE;
  const today = startOfZonedDay(zonedDateKey(new Date(), zone), zone);
  const mine = { assigneeId: user.id, status: "OPEN" as const };
  const [overdue, dueToday, open] = await Promise.all([
    prisma.task.count({ where: { ...mine, dueDate: { lt: today } } }),
    prisma.task.count({ where: { ...mine, dueDate: today } }),
    prisma.task.count({ where: mine }),
  ]);
  return { overdue, dueToday, open };
}

/** What the task form offers: the experiments the member may plan on, and who can be assigned. */
export async function getTaskFormOptions(user: SessionUser) {
  const [experiments, members] = await Promise.all([
    prisma.experiment.findMany({
      where: { AND: [experimentReadScope(user), { endDate: null }] },
      orderBy: { ecode: "asc" },
      select: { id: true, ecode: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true, permissions: { not: "INSPECTOR" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { experiments, members };
}
