import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMyTaskCounts, getTaskCalendar, listTasks } from "@/features/task/queries";
import { createTask, updateTask } from "@/features/task/service";
import { zonedDateKey } from "@/lib/lab-time";
import { AppError } from "@/server/errors";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

const ZONE = "America/Toronto";
vi.hoisted(() => {
  process.env.LAB_TIMEZONE = "America/Toronto";
});

type Lab = Awaited<ReturnType<typeof createLab>>;

/** The laboratory day `days` from today (calendar days, so a clock change never shifts it). */
const dayFromToday = (days: number) => {
  const [y, m, d] = zonedDateKey(new Date(), ZONE).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("tasks", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("lets the experiment's team plan its work, for a member of the team", async () => {
    const task = await createTask(lab.member, {
      title: "Take cuttings",
      dueDate: dayFromToday(2),
      experimentId: lab.experiment.id,
      assigneeId: lab.member.id,
    });
    expect(task.title).toBe("Take cuttings");

    // An outsider can neither plan on the experiment nor be given its work.
    expect(
      (
        await failure(
          createTask(lab.outsider, {
            title: "Nope",
            dueDate: dayFromToday(1),
            experimentId: lab.experiment.id,
          })
        )
      ).code
    ).toBe("FORBIDDEN");
    const notOnTeam = await failure(
      createTask(lab.member, {
        title: "Water",
        dueDate: dayFromToday(1),
        experimentId: lab.experiment.id,
        assigneeId: lab.outsider.id,
      })
    );
    expect(notOnTeam.details).toMatchObject({ reason: "assigneeNotOnTeam" });

    // A lab-wide task is anyone's to plan; an inspector plans nothing.
    await createTask(lab.outsider, { title: "Calibrate the scale", dueDate: dayFromToday(0) });
    const inspector = { ...lab.witness, permissions: "INSPECTOR" as const };
    expect(
      (await failure(createTask(inspector, { title: "No", dueDate: dayFromToday(0) }))).code
    ).toBe("FORBIDDEN");

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "task" },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(["create", "create"]);
  });

  it("takes a unit's experiment, and shows each member only the tasks they may see", async () => {
    const unit = await registerOne(lab, { name: "P-TASK" });
    await createTask(lab.member, {
      title: "Check for mites",
      dueDate: dayFromToday(1),
      unitId: unit.id,
    });
    await createTask(lab.admin, { title: "Lab clean-up", dueDate: dayFromToday(3) });

    const memberSees = await listTasks(lab.member, { view: "all" });
    expect(
      memberSees.map((t) => [t.title, t.experiment?.ecode ?? null, t.unit?.name ?? null])
    ).toEqual([
      ["Check for mites", "AB1", "P-TASK"],
      ["Lab clean-up", null, null],
    ]);
    // The outsider sees the lab-wide task only, and may change it (anyone may plan lab-wide work).
    const outsiderSees = await listTasks(lab.outsider, { view: "all" });
    expect(outsiderSees.map((t) => [t.title, t.canChange])).toEqual([["Lab clean-up", true]]);
  });

  it("is done, reopened, moved and cancelled with a reason, every step audited", async () => {
    const yesterday = dayFromToday(-1);
    const task = await createTask(lab.member, {
      title: "Feed",
      dueDate: yesterday,
      experimentId: lab.experiment.id,
      assigneeId: lab.member.id,
    });
    expect(await getMyTaskCounts(lab.member)).toEqual({ overdue: 1, dueToday: 0, open: 1 });
    expect((await listTasks(lab.member, { view: "mine" }))[0]).toMatchObject({ overdue: true });

    await updateTask(lab.member, task.id, { action: "complete" });
    expect((await failure(updateTask(lab.member, task.id, { action: "complete" }))).code).toBe(
      "CONFLICT"
    );
    await updateTask(lab.member, task.id, { action: "reopen" });
    await updateTask(lab.member, task.id, { action: "reschedule", dueDate: dayFromToday(0) });
    expect(await getMyTaskCounts(lab.member)).toEqual({ overdue: 0, dueToday: 1, open: 1 });
    // Someone outside the experiment cannot touch it.
    expect((await failure(updateTask(lab.outsider, task.id, { action: "complete" }))).code).toBe(
      "FORBIDDEN"
    );
    await updateTask(lab.member, task.id, { action: "cancel", reason: "Plants moved" });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "task", entityId: task.id },
      orderBy: { id: "asc" },
      select: { action: true, reason: true },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "create",
      "complete",
      "reopen",
      "reschedule",
      "cancel",
    ]);
    expect(audit.at(-1)?.reason).toBe("Plants moved");
  });

  it("lays a month out in weeks from Sunday, each task on its day", async () => {
    await createTask(lab.admin, { title: "Inspection", dueDate: "2026-11-18" });
    const calendar = await getTaskCalendar(lab.admin, "2026-11", "all");
    expect(calendar.previous).toBe("2026-10");
    expect(calendar.next).toBe("2026-12");
    // 1 November 2026 is a Sunday; the 30th a Monday, so the last week ends on 5 December.
    expect(calendar.weeks[0]![0]!.key).toBe("2026-11-01");
    expect(calendar.weeks.at(-1)!.at(-1)!.key).toBe("2026-12-05");
    expect(calendar.weeks.every((week) => week.length === 7)).toBe(true);
    const day = calendar.weeks.flat().find((d) => d.key === "2026-11-18");
    expect(day?.tasks.map((t) => t.title)).toEqual(["Inspection"]);
  });
});
