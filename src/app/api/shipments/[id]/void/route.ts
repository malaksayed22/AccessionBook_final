import { voidShipmentSchema } from "@/features/shipment/schemas";
import { voidShipment } from "@/features/shipment/service";
import { parseId, withApi } from "@/server/http";

/** Voids a shipment that has not left (draft or cancelled). Admin only, with a reason. */
export const POST = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "shipment");
  const input = await ctx.json(voidShipmentSchema);
  await voidShipment(ctx.user, id, input, ctx.meta);
  return { ok: true };
});
