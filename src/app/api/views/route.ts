import { saveViewSchema } from "@/features/view/schemas";
import { saveView } from "@/features/view/service";
import { withApi } from "@/server/http";

/** Saves the member's current view of a list under a name. */
export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(saveViewSchema);
  return { ok: true, view: await saveView(ctx.user, input) };
});
