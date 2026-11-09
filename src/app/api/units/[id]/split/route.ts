import { splitGroup } from "@/features/unit/groups";
import { splitGroupSchema } from "@/features/unit/schemas";
import { parseId, withApi } from "@/server/http";

/** Moves some of a plant group's plants into a new group. */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(splitGroupSchema);
  const result = await splitGroup(ctx.user, unitId, input, ctx.meta);
  return { ok: true, unitId: result.group.id, unitName: result.group.name, left: result.left };
});
