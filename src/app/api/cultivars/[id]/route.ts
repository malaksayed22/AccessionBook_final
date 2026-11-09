import { updateCultivarSchema } from "@/features/cultivar/schemas";
import { updateCultivar } from "@/features/cultivar/service";
import { parseId, withApi } from "@/server/http";

export const PATCH = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "cultivar");
  const input = await ctx.json(updateCultivarSchema);
  const cultivar = await updateCultivar(ctx.user, id, input, ctx.meta);
  return { ok: true, cultivar };
});
