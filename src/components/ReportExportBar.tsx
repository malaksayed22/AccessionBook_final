"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonStyles } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/*
 * Usage: <ReportExportBar slug="ctls-monthly" queryString="year=2026&month=3" />
 * Print (the browser's print dialog also saves PDF) and CSV download. The CSV link carries the same
 * filters as the screen, so what is exported is what is shown. The download is the API route, not a
 * page, so it is a plain link (no language prefix). The CTLS monthly report also downloads as
 * Health Canada's form columns.
 */
export function ReportExportBar({ slug, queryString }: { slug: string; queryString: string }) {
  const t = useTranslations("reports.export");
  const download = (format: string) => {
    const params = new URLSearchParams(queryString);
    params.set("format", format);
    return `/api/reports/${slug}?${params.toString()}`;
  };

  return (
    <div className="flex flex-col items-start gap-2 print:hidden sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
          {t("print")}
        </Button>
        {slug === "ctls-monthly" ? (
          <a href={download("ctls-form")} className={cn(buttonStyles({ variant: "secondary" }))}>
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            {t("ctlsForm")}
          </a>
        ) : null}
        <a href={download("csv")} className={cn(buttonStyles({ variant: "primary" }))}>
          <Download aria-hidden="true" className="size-4" />
          {t("csv")}
        </a>
      </div>
      <p className="max-w-prose text-sm text-fg-secondary sm:text-end">{t("note")}</p>
    </div>
  );
}
