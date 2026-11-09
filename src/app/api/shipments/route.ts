import {
  listShipments,
  SHIPMENT_LIST_DIRECTIONS,
  SHIPMENT_LIST_SORTS,
  SHIPMENT_LIST_STATUSES,
} from "@/features/shipment/queries";
import { createShipmentSchema } from "@/features/shipment/schemas";
import { createShipment } from "@/features/shipment/service";
import { dayParam, orderedRange } from "@/lib/date-filter";
import { parseListParams, pickParam, positiveIntParam } from "@/lib/list-params";
import { withApi } from "@/server/http";

export const GET = withApi({ auth: "user" }, async (ctx) => {
  const raw = Object.fromEntries(new URL(ctx.request.url).searchParams) as Record<string, string>;
  const list = parseListParams(raw, { sort: "date", order: "desc" });
  const range = orderedRange(dayParam(raw.from), dayParam(raw.to));
  const { rows, total } = await listShipments(ctx.user, {
    q: list.q,
    direction: pickParam(raw.direction, SHIPMENT_LIST_DIRECTIONS),
    status: pickParam(raw.status, SHIPMENT_LIST_STATUSES),
    organizationId: positiveIntParam(raw.organizationId),
    ...range,
    sort: pickParam(list.sort, SHIPMENT_LIST_SORTS) ?? "date",
    order: list.order,
    page: list.page,
    limit: list.limit,
  });
  return { shipments: rows, total };
});

export const POST = withApi({ auth: "admin" }, async (ctx) => {
  const input = await ctx.json(createShipmentSchema);
  const shipment = await createShipment(ctx.user, input, ctx.meta);
  return { ok: true, shipment };
});
