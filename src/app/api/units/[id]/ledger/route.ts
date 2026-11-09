import { getUnitLedger } from "@/features/unit/queries";
import { parseId, withApi } from "@/server/http";

export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const events = await getUnitLedger(ctx.user, parseId(ctx.params.id, "unit"));
  return { events };
});
