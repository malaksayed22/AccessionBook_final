import { getShipment } from "@/features/shipment/queries";
import { updateShipmentSchema } from "@/features/shipment/schemas";
import { updateShipment } from "@/features/shipment/service";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const shipment = await getShipment(parseId(ctx.params.id, "shipment"));
  if (!shipment) throw errors.notFound("Shipment");
  return { shipment };
});

export const PATCH = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "shipment");
  const input = await ctx.json(updateShipmentSchema);
  const result = await updateShipment(ctx.user, id, input, ctx.meta);
  const shipment = await getShipment(id);
  return result.unchanged ? { ok: true, unchanged: true, shipment } : { ok: true, shipment };
});
