import { listMergeTargets, mergeGroup } from "@/features/unit/groups";
import { mergeGroupSchema } from "@/features/unit/schemas";
import { parseId, withApi } from "@/server/http";

/** Groups this plant group could merge into (`?q=` filters by name). */
export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const q = new URL(ctx.request.url).searchParams.get("q") ?? "";
  return { ok: true, groups: await listMergeTargets(ctx.user, unitId, q) };
});

/** The whole group joins another group. */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(mergeGroupSchema);
  const result = await mergeGroup(ctx.user, unitId, input, ctx.meta);
  return { ok: true, unitId: result.into.id, unitName: result.into.name, plants: result.plants };
});
