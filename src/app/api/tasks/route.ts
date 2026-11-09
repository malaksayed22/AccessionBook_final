import { createTaskSchema } from "@/features/task/schemas";
import { createTask } from "@/features/task/service";
import { withApi } from "@/server/http";

/** Plans a task for a day: lab-wide, on an experiment or on one unit. */
export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(createTaskSchema);
  return { ok: true, task: await createTask(ctx.user, input, ctx.meta) };
});
