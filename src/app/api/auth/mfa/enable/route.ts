import { confirmEnrolment } from "@/features/auth/mfa";
import { codeSchema } from "@/features/auth/schemas";
import { errors } from "@/server/errors";
import { withApi } from "@/server/http";

/** Confirms the authenticator with one code, turns two-step on and returns the recovery codes once. */
export const POST = withApi(
  { auth: "user", allowIncompleteSession: true, maxBodyBytes: 1024 },
  async (ctx) => {
    if (ctx.session!.state === "mfa-required") throw errors.mfaRequired();
    const { code } = await ctx.json(codeSchema);
    return { ok: true, ...(await confirmEnrolment(ctx.user, ctx.session!.id, code, ctx.meta)) };
  }
);
