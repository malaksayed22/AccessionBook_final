import { beginEnrolment } from "@/features/auth/mfa";
import { errors } from "@/server/errors";
import { withApi } from "@/server/http";

/** Starts two-step setup: returns the secret and QR code to add to an authenticator app. */
export const POST = withApi(
  { auth: "user", allowIncompleteSession: true, maxBodyBytes: 1024 },
  async (ctx) => {
    if (ctx.session!.state === "mfa-required") throw errors.mfaRequired();
    return { ok: true, ...(await beginEnrolment(ctx.user, ctx.meta)) };
  }
);
