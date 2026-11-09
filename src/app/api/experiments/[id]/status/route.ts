import { z } from "zod";
import { completeExperimentSchema } from "@/features/experiment/schemas";
import { completeExperiment, reopenExperiment } from "@/features/experiment/service";
import { parseId, withApi } from "@/server/http";

const bodySchema = z.discriminatedUnion("action", [
  completeExperimentSchema.extend({ action: z.literal("complete") }),
  z.object({ action: z.literal("reopen") }),
]);

/** Completes a running experiment (setting its end date) or reopens a completed one (admins). */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const input = await ctx.json(bodySchema);
  if (input.action === "reopen") {
    await reopenExperiment(ctx.user, experimentId, ctx.meta);
    return { ok: true };
  }
  const result = await completeExperiment(ctx.user, experimentId, input, ctx.meta);
  return { ok: true, endDate: result.endDate.toISOString() };
});
