import { placeHold, releaseHold } from "@/features/qa/service";
import { holdRequestSchema } from "@/features/unit/schemas";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const body = await ctx.json(holdRequestSchema);
  const text = body.reason || body.note || "";

  if (body.action === "hold") {
    if (!text) throw errors.validation("A hold reason is required");
    const kind = body.kind ?? "HOLD";
    await placeHold(ctx.user, unitId, { reason: text, kind }, ctx.meta);
    return { ok: true, holdStatus: kind };
  }
  if (!text) throw errors.validation("A reason for releasing the hold is required");
  // Releasing re-opens movement of regulated material: the password must have been confirmed recently.
  ctx.requireRecentAuth();
  await releaseHold(ctx.user, unitId, { note: text }, ctx.meta);
  return { ok: true, holdStatus: null };
});
