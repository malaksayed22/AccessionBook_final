import { getQaOverview, QA_SEVERITIES, QA_VIEWS } from "@/features/qa/queries";
import { parseListParams, pickParam } from "@/lib/list-params";
import { withApi } from "@/server/http";

export const GET = withApi({ auth: "user" }, async (ctx) => {
  const raw = Object.fromEntries(new URL(ctx.request.url).searchParams) as Record<string, string>;
  const list = parseListParams(raw, { sort: "" });
  return getQaOverview(ctx.user, {
    view: pickParam(raw.view, QA_VIEWS) ?? "overview",
    q: list.q,
    sort: list.sort || undefined,
    order: list.order,
    page: list.page,
    limit: list.limit,
    severity: pickParam(raw.severity, QA_SEVERITIES),
  });
});
