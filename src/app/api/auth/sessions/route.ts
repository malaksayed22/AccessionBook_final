import { revokeOtherSessions } from "@/features/auth/service";
import { withApi } from "@/server/http";
import { listActiveSessions } from "@/server/session";

/** Signs you out of every device except this one. */
export const DELETE = withApi({ auth: "user" }, async (ctx) => {
  const { ended } = await revokeOtherSessions(ctx.user, ctx.session!.id, ctx.meta);
  return { ok: true, ended };
});

/** Your own active sessions, so an unfamiliar one can be spotted and ended. */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const sessions = await listActiveSessions(ctx.user.id);
  return {
    ok: true,
    sessions: sessions.map((s) => ({ ...s, current: s.id === ctx.session!.id })),
  };
});
