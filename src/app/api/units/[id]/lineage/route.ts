import { linkParentSchema } from "@/features/unit/schemas";
import { linkParent } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(linkParentSchema);
  const result = await linkParent(ctx.user, unitId, input, ctx.meta);
  return { ok: true, parentName: result.parentName };
});
