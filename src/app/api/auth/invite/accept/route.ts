import { acceptInviteSchema } from "@/features/auth/schemas";
import { acceptInvite } from "@/features/auth/service";
import { setSessionCookie } from "@/lib/auth";
import { withApi } from "@/server/http";

/** Public: the invitee proves possession of the link and sets their own password. */
export const POST = withApi({ auth: "public", maxBodyBytes: 4096 }, async (ctx) => {
  const input = await ctx.json(acceptInviteSchema);
  const result = await acceptInvite(input, ctx.meta);
  await setSessionCookie(result.token, result.expiresAt);
  return { ok: true, next: result.next };
});
