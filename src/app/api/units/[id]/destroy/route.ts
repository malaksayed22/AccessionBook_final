import { destroyUnitSchema } from "@/features/unit/schemas";
import { destroyUnit } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  ctx.requireRecentAuth();
  const input = await ctx.json(destroyUnitSchema);
  const result = await destroyUnit(ctx.user, unitId, input, ctx.meta);
  return { ok: true, destroyedAt: result.destroyedAt.toISOString() };
});
