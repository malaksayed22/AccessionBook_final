import { loginSchema } from "@/features/auth/schemas";
import { signIn } from "@/features/auth/service";
import { readSessionToken, setSessionCookie } from "@/lib/auth";
import { withApi } from "@/server/http";

/** Public: password step of sign-in. `next` tells the client whether a second step follows. */
export const POST = withApi({ auth: "public", maxBodyBytes: 4096 }, async (ctx) => {
  const input = await ctx.json(loginSchema);
  const result = await signIn(input, {
    meta: ctx.meta,
    previousToken: await readSessionToken(),
  });
  await setSessionCookie(result.token, result.expiresAt);
  return { ok: true, ...result.user, next: result.next };
});
