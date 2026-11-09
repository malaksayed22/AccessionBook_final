import { disableMfa } from "@/features/auth/mfa";
import { disableMfaSchema } from "@/features/auth/schemas";
import { withApi } from "@/server/http";

/** Turns two-step off (not allowed for administrators where it is mandatory). */
export const POST = withApi({ auth: "user", maxBodyBytes: 2048 }, async (ctx) => {
  await disableMfa(ctx.user, await ctx.json(disableMfaSchema), ctx.meta);
  return { ok: true };
});
