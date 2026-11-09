import { regenerateRecoveryCodes } from "@/features/auth/mfa";
import { codeSchema } from "@/features/auth/schemas";
import { withApi } from "@/server/http";

/** Replaces all recovery codes (the old ones stop working). Needs a current code. */
export const POST = withApi({ auth: "user", maxBodyBytes: 1024 }, async (ctx) => {
  const { code } = await ctx.json(codeSchema);
  return { ok: true, ...(await regenerateRecoveryCodes(ctx.user, code, ctx.meta)) };
});
