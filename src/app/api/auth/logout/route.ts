import { signOut } from "@/features/auth/service";
import { clearSessionCookie } from "@/lib/auth";
import { withApi } from "@/server/http";

/** Ends the current session in the database and removes the cookie. Safe to call when signed out. */
export const POST = withApi({ auth: "public" }, async (ctx) => {
  if (ctx.session) await signOut(ctx.session, ctx.meta);
  await clearSessionCookie();
  return { ok: true };
});
