import { updateLabSettingsSchema } from "@/features/settings/schemas";
import { updateLabSettings } from "@/features/settings/service";
import { withApi } from "@/server/http";

/** Saves the laboratory's settings. Administrators only; the password is confirmed first. */
export const PATCH = withApi<Record<string, never>, "admin">({ auth: "admin" }, async (ctx) => {
  ctx.requireRecentAuth();
  const input = await ctx.json(updateLabSettingsSchema);
  return { ok: true, ...(await updateLabSettings(ctx.user, input, ctx.meta)) };
});
