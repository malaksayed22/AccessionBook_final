import { revokeOwnSession } from "@/features/auth/service";
import { parseId, withApi } from "@/server/http";

/** Ends one of your own sessions. Other people's sessions are reported as not found. */
export const DELETE = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  await revokeOwnSession(ctx.user, parseId(ctx.params.id, "session"), ctx.meta);
  return { ok: true };
});
