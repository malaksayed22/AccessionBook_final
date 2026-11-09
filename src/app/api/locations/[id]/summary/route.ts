import { getLocationSummary } from "@/features/location/queries";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

/** What is in a location now, and how much of it is one cultivar (`?cultivarId=`). Counts only. */
export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "location");
  const raw = new URL(ctx.request.url).searchParams.get("cultivarId");
  const cultivarId = raw === null ? undefined : Number(raw);
  if (cultivarId !== undefined && (!Number.isInteger(cultivarId) || cultivarId <= 0)) {
    throw errors.validation("cultivarId must be a positive whole number");
  }
  const summary = await getLocationSummary(ctx.user, id, cultivarId);
  if (!summary) throw errors.notFound("Location");
  return { ok: true, summary };
});
