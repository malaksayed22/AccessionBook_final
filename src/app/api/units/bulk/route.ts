import { applyBulk } from "@/features/unit/bulk";
import { bulkUnitsSchema } from "@/features/unit/schemas";
import { withApi } from "@/server/http";

/** One action (move, stage, hold, release, destroy) on several units at once; all or nothing. */
export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(bulkUnitsSchema);
  // Releasing re-opens movement of regulated material: the password must have been confirmed recently.
  if (input.action === "release") ctx.requireRecentAuth();
  const result = await applyBulk(ctx.user, input, ctx.meta);
  return { ok: true, action: result.action, count: result.count };
});
