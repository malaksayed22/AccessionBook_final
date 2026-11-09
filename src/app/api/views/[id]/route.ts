import { deleteView } from "@/features/view/service";
import { parseId, withApi } from "@/server/http";

/** Deletes one of the member's own saved views. */
export const DELETE = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  await deleteView(ctx.user, parseId(ctx.params.id, "view"));
  return { ok: true };
});
