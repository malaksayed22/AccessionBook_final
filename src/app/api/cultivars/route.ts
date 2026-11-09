import { createCultivarSchema } from "@/features/cultivar/schemas";
import { createCultivar } from "@/features/cultivar/service";
import { withApi } from "@/server/http";

/** Admin adds a cultivar to the genetic library. */
export const POST = withApi({ auth: "admin" }, async (ctx) => {
  const input = await ctx.json(createCultivarSchema);
  const cultivar = await createCultivar(ctx.user, input, ctx.meta);
  return { ok: true, cultivar };
});
