import { takeTissueSampleSchema } from "@/features/unit/schemas";
import { takeTissueSample } from "@/features/unit/tissue";
import { parseId, withApi } from "@/server/http";

/** Takes a tissue sample of a plant or a culture for a lab test. */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(takeTissueSampleSchema);
  const sample = await takeTissueSample(ctx.user, unitId, input, ctx.meta);
  return { ok: true, sample };
});
