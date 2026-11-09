import { reauthSchema } from "@/features/auth/schemas";
import { reauthenticate } from "@/features/auth/service";
import { withApi } from "@/server/http";

/** Confirm your password before a sensitive action (valid for a few minutes). */
export const POST = withApi({ auth: "user", maxBodyBytes: 2048 }, async (ctx) => {
  const { password } = await ctx.json(reauthSchema);
  await reauthenticate(ctx.user, ctx.session!.id, password, ctx.meta);
  return { ok: true };
});
