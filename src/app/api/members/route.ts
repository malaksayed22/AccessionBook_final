import { inviteMemberSchema } from "@/features/member/schemas";
import { inviteMember } from "@/features/member/service";
import { withApi } from "@/server/http";

/** Admin invites a new member. They stay inactive until they accept and set a password. */
export const POST = withApi({ auth: "admin" }, async (ctx) => {
  const input = await ctx.json(inviteMemberSchema);
  const result = await inviteMember(ctx.user, input, ctx.meta);
  return { ok: true, ...result };
});
