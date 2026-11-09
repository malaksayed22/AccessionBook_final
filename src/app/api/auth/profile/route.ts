import { profileSchema } from "@/features/auth/schemas";
import { updateProfile } from "@/features/auth/service";
import { withApi } from "@/server/http";

/** Change your own username, code prefix or password. Always needs the current password. */
export const PATCH = withApi({ auth: "user", maxBodyBytes: 8192 }, async (ctx) => {
  const input = await ctx.json(profileSchema);
  return { ok: true, ...(await updateProfile(ctx.user, ctx.session!.id, input, ctx.meta)) };
});
