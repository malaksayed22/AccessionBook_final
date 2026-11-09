import { taskCommandSchema } from "@/features/task/schemas";
import { updateTask } from "@/features/task/service";
import { parseId, withApi } from "@/server/http";

/** Completes, reopens, cancels (with a reason), reschedules or reassigns a task. */
export const PATCH = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "task");
  const command = await ctx.json(taskCommandSchema);
  return { ok: true, task: await updateTask(ctx.user, id, command, ctx.meta) };
});
