export const dynamic = "force-dynamic";

import {
  ClipboardCheck,
  FlaskConical,
  Lock,
  Package,
  ScrollText,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LockedState } from "@/components/ui/LockedState";
import { PageHeader } from "@/components/ui/PageHeader";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { getReportsByCategory, REPORT_CATEGORIES } from "@/lib/report-catalog";
import type { ReportCategory } from "@/lib/reports/types";
import { canReadCompliance } from "@/lib/roles";

const CATEGORY_ICONS: Record<ReportCategory, LucideIcon> = {
  regulatory: Shield,
  inventory: Package,
  compliance: ClipboardCheck,
  operations: FlaskConical,
  audit: ScrollText,
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: t("pageTitle") };
}

export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  await resolveRequestLocale(params);
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

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} className="pb-0" />

      {REPORT_CATEGORIES.map((category) => {
        const reports = getReportsByCategory(category);
        if (reports.length === 0) return null;
        const Icon = CATEGORY_ICONS[category];
        return (
          <section key={category} aria-labelledby={`category-${category}`} className="space-y-3">
            <h2
              id={`category-${category}`}
              className="flex items-center gap-2 text-lg font-semibold text-fg"
            >
              <Icon aria-hidden="true" className="size-5 text-fg-secondary" />
              {t(`categories.${category}`)}
            </h2>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {reports.map((report) => (
                <li key={report.id}>
                  <Link
                    href={`/compliance/reports/${report.id}`}
                    className="group flex h-full flex-col rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none"
                  >
                    <span className="font-semibold text-fg group-hover:underline">
                      {t(`catalog.${report.id}.title`)}
                    </span>
                    <span className="mt-2 text-sm text-fg-secondary">
                      {t(`catalog.${report.id}.description`)}
                    </span>
                    <span className="mt-4 text-sm font-medium text-accent-text">{t("open")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
