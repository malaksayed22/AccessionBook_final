import { updateIncidentSchema } from "@/features/qa/schemas";
import { updateIncident } from "@/features/qa/service";
import { parseId, withApi } from "@/server/http";

export const PATCH = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "incident");
  const input = await ctx.json(updateIncidentSchema);
  const result = await updateIncident(ctx.user, id, input, ctx.meta);
  return result.unchanged ? { ok: true, unchanged: true } : { ok: true, status: result.status };
});
