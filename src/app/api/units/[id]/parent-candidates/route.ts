import { searchParentCandidates } from "@/features/unit/queries";
import { parseId, withApi } from "@/server/http";

/** Units whose name matches `?q=` (at least two characters), for choosing a parent to link. */
export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const q = new URL(ctx.request.url).searchParams.get("q")?.slice(0, 100) ?? "";
  return { units: await searchParentCandidates(ctx.user, unitId, q) };
});
