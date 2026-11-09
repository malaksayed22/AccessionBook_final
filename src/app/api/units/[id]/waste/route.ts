import { recordWasteSchema } from "@/features/unit/schemas";
import { recordWaste } from "@/features/unit/waste";
import { parseId, withApi } from "@/server/http";

/** Disposes of part of the unit as waste (booked as destroyed on the CTLS return). */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(recordWasteSchema);
  return { ok: true, ...(await recordWaste(ctx.user, unitId, input, ctx.meta)) };
});
