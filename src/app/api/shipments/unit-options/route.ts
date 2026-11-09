import { searchShippableUnits } from "@/features/shipment/queries";
import { withApi } from "@/server/http";

/** Units that can leave on an outbound shipment, for the unit picker on the shipment form. */
export const GET = withApi({ auth: "admin" }, async (ctx) => {
  const q = new URL(ctx.request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  return { units: await searchShippableUnits(ctx.user, q) };
});
