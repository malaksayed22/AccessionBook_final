import { voidRecordSchema } from "@/features/qa/schemas";
import { voidLabTest } from "@/features/qa/service";
import { parseId, withApi } from "@/server/http";

/** Voids a lab result with a reason. The member who recorded it or an admin (the service decides). */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "test");
  const input = await ctx.json(voidRecordSchema);
  await voidLabTest(ctx.user, id, input, ctx.meta);
  return { ok: true };
});
