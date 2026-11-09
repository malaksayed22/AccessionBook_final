import { lookup } from "@/features/search/queries";
import { withApi } from "@/server/http";

/** Command-palette lookup: a few units, experiments and cultivars the member may read. */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const q = new URL(ctx.request.url).searchParams.get("q") ?? "";
  return lookup(ctx.user, q);
});
