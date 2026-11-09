import { measureUnitSchema } from "@/features/unit/schemas";
import { measureUnit } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(measureUnitSchema);
  const result = await measureUnit(ctx.user, unitId, input, ctx.meta);
  return { ok: true, changes: result.changes };
});
