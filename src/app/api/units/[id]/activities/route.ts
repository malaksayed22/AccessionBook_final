import { recordActivity } from "@/features/unit/documents";
import { recordActivitySchema } from "@/features/unit/schemas";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(recordActivitySchema);
  const result = await recordActivity(ctx.user, unitId, input, ctx.meta);
  return { ok: true, activity: { id: result.activityId } };
});
