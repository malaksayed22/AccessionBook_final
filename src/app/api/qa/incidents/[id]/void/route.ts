import { voidRecordSchema } from "@/features/qa/schemas";
import { voidIncident } from "@/features/qa/service";
import { parseId, withApi } from "@/server/http";

/** Voids an incident with a reason. Admin only. */
export const POST = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "incident");
  const input = await ctx.json(voidRecordSchema);
  await voidIncident(ctx.user, id, input, ctx.meta);
  return { ok: true };
});
