import { searchUnitOptions } from "@/features/qa/queries";
import { withApi } from "@/server/http";

/** Units to pick from in the hold and incident forms. `scope=holdable` hides units that cannot be held. */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const params = new URL(ctx.request.url).searchParams;
  const q = params.get("q")?.trim().slice(0, 100) ?? "";
  const scope = params.get("scope") === "holdable" ? "holdable" : "any";
  return { units: await searchUnitOptions(ctx.user, q, scope) };
});
