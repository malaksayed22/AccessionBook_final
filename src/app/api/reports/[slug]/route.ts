import { loadCtlsFormCsv, loadReport, loadReportCsv } from "@/features/report/queries";
import { parseReportFilters } from "@/lib/reports/filters";
import { errors } from "@/server/errors";
import { withApi } from "@/server/http";

/**
 * Regulatory reports, as JSON or (with `format=csv`) a download; the CTLS monthly report also comes
 * as Health Canada's form columns (`format=ctls-form`). Filters are validated:
 * a malformed date is a 400, never a silently wider export. CSV column names and dates are the
 * stable English/ISO regulatory forms by design, whatever the reader's language. Admins, quality
 * assurance and inspectors.
 */
export const GET = withApi<{ slug: string }, "compliance">({ auth: "compliance" }, async (ctx) => {
  const params = new URL(ctx.request.url).searchParams;
  const { filters, invalid } = parseReportFilters((key) => params.get(key) ?? undefined);
  if (invalid.length > 0) {
    throw errors.validation(`Invalid report filter: ${invalid.join(", ")}`, { fields: invalid });
  }

  const format = params.get("format");
  if (format === "csv" || format === "ctls-form") {
    if (format === "ctls-form" && ctx.params.slug !== "ctls-monthly") {
      throw errors.notFound("Report");
    }
    const { csv, filename } =
      format === "ctls-form"
        ? await loadCtlsFormCsv(ctx.user, filters)
        : await loadReportCsv(ctx.user, ctx.params.slug, filters);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return loadReport(ctx.user, ctx.params.slug, filters);
});
