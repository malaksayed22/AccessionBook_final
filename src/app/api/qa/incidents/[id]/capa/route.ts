import { runCapaCommand } from "@/features/qa/capa";
import { capaCommandSchema } from "@/features/qa/schemas";
import { parseId, withApi } from "@/server/http";

/** Raises a corrective or preventive action on an incident, records it done, or checks it worked. */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "incident");
  const command = await ctx.json(capaCommandSchema);
  return { ok: true, ...(await runCapaCommand(ctx.user, id, command, ctx.meta)) };
});
