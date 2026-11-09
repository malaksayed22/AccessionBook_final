import { takeSample } from "@/features/unit/samples";
import { takeSampleSchema } from "@/features/unit/schemas";
import { parseId, withApi } from "@/server/http";

/** Takes part of the unit as a sample, which becomes a unit of its own. */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const parentId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(takeSampleSchema);
  const result = await takeSample(ctx.user, parentId, input, ctx.meta);
  return { ok: true, unitId: result.sample.id, unitName: result.sample.name };
});
