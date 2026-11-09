import { experimentMemberSchema } from "@/features/experiment/schemas";
import { addExperimentMember, removeExperimentMember } from "@/features/experiment/service";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const { userId } = await ctx.json(experimentMemberSchema);
  const result = await addExperimentMember(ctx.user, experimentId, userId, ctx.meta);
  if (!result.added) throw errors.conflict("Member already assigned");
  return { name: result.name, userId };
});

export const DELETE = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const userId = parseId(new URL(ctx.request.url).searchParams.get("userId"), "member");
  await removeExperimentMember(ctx.user, experimentId, userId, ctx.meta);
  return { ok: true };
});
