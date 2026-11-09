import { beforeEach, describe, expect, it } from "vitest";
import { listNotifications } from "@/features/notification/queries";
import { markAllNotificationsRead, markNotificationRead } from "@/features/notification/service";
import { createTask, updateTask } from "@/features/task/service";
import { zonedDateKey } from "@/lib/lab-time";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { createLab, resetDatabase } from "./helpers";

const inTwoDays = () => zonedDateKey(new Date(Date.now() + 2 * 86_400_000), env().LAB_TIMEZONE);

describe("notifications", () => {
  let lab: Awaited<ReturnType<typeof createLab>>;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const page = (user: typeof lab.admin, unread = false) =>
    listNotifications(user, { page: 1, limit: 50, unread });

  it("tells administrators of every change made by someone else, not their own", async () => {
    const before = (await page(lab.admin)).total;
    await createTask(lab.member, {
      title: "Take cuttings",
      dueDate: inTwoDays(),
      experimentId: lab.experiment.id,
    });
    const after = await page(lab.admin);
    expect(after.total).toBe(before + 1);
    expect(after.rows[0]).toMatchObject({
      kind: "activity",
      read: false,
      actorName: lab.member.name,
      action: "create",
      entityType: "task",
      entityLabel: "Take cuttings",
      href: "/inventory/tasks",
    });

    // The admin's own change is not a notice for them.
    await createTask(lab.admin, { title: "Own work", dueDate: inTwoDays() });
    expect((await page(lab.admin)).total).toBe(before + 1);
    // A member hears nothing of other people's changes.
    expect((await page(lab.member)).rows.filter((r) => r.kind === "activity")).toEqual([]);
  });

  it("tells a member when a task is given to them, on creation and on reassignment", async () => {
    const task = await createTask(lab.admin, {
      title: "Water the mothers",
      dueDate: inTwoDays(),
      experimentId: lab.experiment.id,
      assigneeId: lab.member.id,
    });
    const mine = await page(lab.member);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]).toMatchObject({
      kind: "task_assigned",
      actorName: lab.admin.name,
      task: { title: "Water the mothers" },
    });
    expect(mine.rows[0]!.task!.code).toMatch(/^T-\d{4,}$/);

    // Unassigning and assigning again is a second notice; giving yourself a task is none.
    await updateTask(lab.admin, task.id, { action: "assign", assigneeId: null });
    await updateTask(lab.admin, task.id, { action: "assign", assigneeId: lab.member.id });
    expect((await page(lab.member)).total).toBe(2);
    await createTask(lab.member, {
      title: "Self",
      dueDate: inTwoDays(),
      experimentId: lab.experiment.id,
      assigneeId: lab.member.id,
    });
    expect((await page(lab.member)).total).toBe(2);
  });

  it("marks one or all read, and only the reader's own", async () => {
    for (const title of ["A", "B"]) {
      await createTask(lab.member, {
        title,
        dueDate: inTwoDays(),
        experimentId: lab.experiment.id,
      });
    }
    const { rows, unread } = await page(lab.admin, true);
    expect(unread).toBeGreaterThanOrEqual(2);
    // Someone else cannot mark the admin's notice.
    await markNotificationRead(lab.member, rows[0]!.id);
    expect((await page(lab.admin)).unread).toBe(unread);
    await markNotificationRead(lab.admin, rows[0]!.id);
    expect((await page(lab.admin)).unread).toBe(unread - 1);
    await markAllNotificationsRead(lab.admin);
    expect((await page(lab.admin, true)).total).toBe(0);
    expect(await prisma.notification.count({ where: { userId: lab.admin.id } })).toBe(
      (await page(lab.admin)).total
    );
  });
});
