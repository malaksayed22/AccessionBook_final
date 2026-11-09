export const dynamic = "force-dynamic";

import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ReportDisplay } from "@/components/ReportDisplay";
import { ReportExportBar } from "@/components/ReportExportBar";
import { ReportFiltersForm } from "@/components/ReportFiltersForm";
import { Banner } from "@/components/ui/Banner";
import { LockedState } from "@/components/ui/LockedState";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadReport, loadReportFilterOptions } from "@/features/report/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";
import { getReportMeta } from "@/lib/report-catalog";
import { labZone } from "@/lib/reports/date-range";
import { applyReportDefaults, filtersToQuery, parseReportFilters } from "@/lib/reports/filters";
import type { ReportFilters } from "@/lib/reports/types";
import { canReadCompliance } from "@/lib/roles";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations("reports");
  const meta = getReportMeta(slug);
  return { title: meta ? t(`catalog.${meta.id}.title`) : t("pageTitle") };
}

export default async function ReportDetailPage({ params, searchParams }: Props) {
  await resolveRequestLocale(params);
  const { slug } = await params;
  const user = await requirePageUser();
  const t = await getTranslations("reports");

  if (!canReadCompliance(user)) {
    return (
      <div>
        <PageHeader title={t("title")} />
        <LockedState
          icon={<Lock />}
          title={t("locked.title")}
          body={t("locked.body")}
          action={{ label: t("locked.action"), href: "/dashboard" }}
        />
      </div>
    );
  }

  const report = getReportMeta(slug);
  if (!report) notFound();

  const raw = await searchParams;
  const zone = labZone();
  const { filters: given, invalid } = parseReportFilters((key) => raw[key]);
  const filters = applyReportDefaults(report, given, new Date(), zone);
  const options = await loadReportFilterOptions(user);

  const header = (
    <PageHeader
      breadcrumbs={<HubCrumbs tab="reports" current={t(`catalog.${report.id}.title`)} />}
      title={t(`catalog.${report.id}.title`)}
      description={t(`catalog.${report.id}.description`)}
      actions={
        invalid.length === 0 ? (
          <ReportExportBar slug={slug} queryString={filtersToQuery(filters)} />
        ) : undefined
      }
    />
  );

  const form = (
    <ReportFiltersForm report={report} defaults={filters} options={options} zone={zone} />
  );

  if (invalid.length > 0) {
    return (
      <div className="report-page space-y-4">
        {header}
        {form}
        <Banner tone="danger" title={t("invalid.title")}>
          {t("invalid.body", {
            fields: invalid.map((field) => t(`invalid.fields.${field}`)).join(", "),
          })}
        </Banner>
      </div>
    );
  }

  const result = await loadReport(user, slug, filters);
  const format = await getFormatter();
  const period = periodText(filters, report.filters, t, format);

  return (
    <div className="report-page space-y-4">
      {header}
      {form}
      <ReportDisplay result={result} zone={zone} period={period} />
    </div>
  );
}

/** The period the report covers, in the reader's language; undefined for reports with no period. */
function periodText(
  filters: ReportFilters,
  offered: readonly string[],
  t: Awaited<ReturnType<typeof getTranslations<"reports">>>,
  format: Awaited<ReturnType<typeof getFormatter>>
): string | undefined {
  if (offered.includes("month") && filters.year && filters.month) {
    const month = Math.min(12, Math.max(1, filters.month)) as
      1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    return `${t(`filters.months.${month}`)} ${format.number(filters.year, { useGrouping: false })}`;
  }
  if (offered.includes("dateRange") && (filters.from || filters.to)) {
    return `${filters.from ?? "…"} – ${filters.to ?? "…"}`;
  }
  if (offered.includes("asOf") && filters.asOf) return filters.asOf;
  return undefined;
}
