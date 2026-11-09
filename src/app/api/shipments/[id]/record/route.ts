import { recordLocale, recordResponse } from "@/features/record/common";
import { buildShipmentRecord } from "@/features/shipment/record";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

/** The shipment's chain of custody as a PDF, in the reader's language (`?locale=fr`). */
export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "shipment");
  const file = await buildShipmentRecord(ctx.user, id, recordLocale(ctx.request));
  if (!file) throw errors.notFound("Shipment");
  return recordResponse(file);
});
