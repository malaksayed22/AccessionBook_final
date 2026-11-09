import { sopCommandSchema } from "@/features/sop/schemas";
import { assertSopsEnabled } from "@/features/sop/enabled";
import { updateSop } from "@/features/sop/service";
import { parseId, withApi } from "@/server/http";

/**
 * Drafts a new version, approves the draft or signs the version in effect. Approving and signing
 * are electronic signatures, so the password is confirmed first.
 */
export const PATCH = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  assertSopsEnabled();
  const id = parseId(ctx.params.id, "procedure");
  const command = await ctx.json(sopCommandSchema);
  if (command.action !== "draft") ctx.requireRecentAuth();
  return { ok: true, ...(await updateSop(ctx.user, id, command, ctx.meta)) };
});
