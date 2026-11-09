import { memberActionSchema } from "@/features/member/schemas";
import {
  changeMemberRole,
  deactivateMember,
  pseudonymiseMember,
  reactivateMember,
  reissueInvite,
  resetMemberMfa,
  revokeInvite,
} from "@/features/member/service";
import { parseId, withApi } from "@/server/http";

/**
 * Issue a fresh link (the old one stops working), deactivate, reactivate, reset two-step
 * verification, change the role, or erase a deactivated member's personal data.
 */
export const PATCH = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "member");
  const command = await ctx.json(memberActionSchema);
  switch (command.action) {
    case "reissue":
      return { ok: true, ...(await reissueInvite(ctx.user, id, ctx.meta)) };
    case "deactivate":
      ctx.requireRecentAuth();
      return deactivateMember(ctx.user, id, ctx.meta, { reason: command.reason });
    case "reset-mfa":
      ctx.requireRecentAuth();
      return resetMemberMfa(ctx.user, id, ctx.meta, { reason: command.reason });
    case "pseudonymise":
      ctx.requireRecentAuth();
      return pseudonymiseMember(ctx.user, id, command, ctx.meta);
    case "reactivate":
      return reactivateMember(ctx.user, id, ctx.meta);
    case "role":
      ctx.requireRecentAuth();
      return changeMemberRole(ctx.user, id, command, ctx.meta);
  }
});

/** Revokes a pending invitation. Members who have signed in are deactivated, never deleted. */
export const DELETE = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  await revokeInvite(ctx.user, parseId(ctx.params.id, "member"), ctx.meta);
  return { ok: true };
});
