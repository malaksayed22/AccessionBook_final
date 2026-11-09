import { moveUnitSchema } from "@/features/unit/schemas";
import { moveUnit } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(moveUnitSchema);
  // The explicit transfer action always requires the barcode scan.
  const result = await moveUnit(ctx.user, unitId, input, { requireScan: true }, ctx.meta);
  return { ok: true, location: result.location };
});
