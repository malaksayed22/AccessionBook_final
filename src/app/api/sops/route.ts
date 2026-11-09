import { createSopSchema } from "@/features/sop/schemas";
import { assertSopsEnabled } from "@/features/sop/enabled";
import { createSop } from "@/features/sop/service";
import { withApi } from "@/server/http";

/** Writes a new procedure with its first version, as a draft. Quality assurance and admins. */
export const POST = withApi({ auth: "user" }, async (ctx) => {
  assertSopsEnabled();
  const input = await ctx.json(createSopSchema);
  return { ok: true, sop: await createSop(ctx.user, input, ctx.meta) };
});
