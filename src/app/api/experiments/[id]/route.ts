import { updateExperimentSchema } from "@/features/experiment/schemas";
import { updateExperiment } from "@/features/experiment/service";
import { parseId, withApi } from "@/server/http";

export const PATCH = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const input = await ctx.json(updateExperimentSchema);
  const result = await updateExperiment(ctx.user, experimentId, input, ctx.meta);
  return result.unchanged ? { ok: true, unchanged: true } : { ok: true };
});
