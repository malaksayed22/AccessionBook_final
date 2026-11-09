import { completeSignIn } from "@/features/auth/mfa";
import { codeSchema } from "@/features/auth/schemas";
import { withApi } from "@/server/http";

/** Second step of sign-in: an authenticator code or an unused recovery code. */
export const POST = withApi(
  { auth: "user", allowIncompleteSession: true, maxBodyBytes: 1024 },
  async (ctx) => {
    const { code } = await ctx.json(codeSchema);
    const result = await completeSignIn(ctx.user, ctx.session!.id, code, ctx.meta);
    return { ok: true, ...result };
  }
);
