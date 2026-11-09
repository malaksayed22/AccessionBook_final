import { getIntakeContext } from "@/features/unit/queries";
import { parseId, withApi } from "@/server/http";

export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unit = await getIntakeContext(parseId(ctx.params.id, "unit"));
  return { ok: true, unit };
});
