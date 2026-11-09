export const dynamic = "force-dynamic";

import { BookCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { StatCard } from "@/components/page/StatCard";
import { NewSopButton } from "@/components/sop/SopDialogs";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { sopsEnabled } from "@/features/sop/enabled";
import { listSops, type SopRow } from "@/features/sop/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { isQuality } from "@/lib/roles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sops");
  return { title: t("pageTitle") };
}

export default async function SopsPage({ params }: { params: Promise<{ locale: string }> }) {
  if (!sopsEnabled()) notFound();
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("sops");
  const format = await getFormatter();
  const rows = await listSops(user);
  const toSign = rows.filter((row) => row.mine === "toSign").length;
  const inEffect = rows.filter((row) => row.effective).length;
  const drafts = rows.filter((row) => row.draftVersion !== null).length;

  const columns: Array<Column<SopRow>> = [
    {
      id: "code",
      header: t("columns.code"),
      rowHeader: true,
      cell: (row) => (
        <Link
          href={`/quality/sops/${row.id}`}
          className="font-medium text-accent-text hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    { id: "title", header: t("columns.title"), cell: (row) => row.title },
    {
      id: "version",
      header: t("columns.version"),
      cell: (row) =>
        row.effective ? (
          <span>
            {t("versionInEffect", { version: row.effective.version })}
            <span className="block text-xs text-fg-secondary">
              {t("since", { date: format.dateTime(row.effective.approvedAt, "date") })}
            </span>
          </span>
        ) : (
          <span className="text-fg-secondary">{t("notInEffect")}</span>
        ),
    },
    {
      id: "draft",
      header: t("columns.draft"),
      cell: (row) =>
        row.draftVersion !== null ? (
          <Badge tone="warning">{t("draftVersion", { version: row.draftVersion })}</Badge>
        ) : (
          <span className="text-fg-secondary">{t("noDraft")}</span>
        ),
    },
    {
      id: "signed",
      header: t("columns.signed"),
      align: "end",
      cell: (row) =>
        row.effective ? (
          <span className="tabular-nums">
            {t("signedCount", { signed: row.signed, staff: row.staff })}
          </span>
        ) : (
          <span className="text-fg-secondary">{t("noDraft")}</span>
        ),
    },
    {
      id: "mine",
      header: t("columns.mine"),
      cell: (row) =>
        row.mine === "signed" ? (
          <Badge tone="success">{t("mine.signed")}</Badge>
        ) : row.mine === "toSign" ? (
          <Badge tone="danger">{t("mine.toSign")}</Badge>
        ) : (
          <span className="text-fg-secondary">{t("mine.none")}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={isQuality(user) ? <NewSopButton /> : undefined}
      />

      <section aria-label={t("cards.label")} className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          index={0}
          label={t("cards.toSign.label")}
          value={format.number(toSign, "count")}
          hint={t("cards.toSign.hint")}
          tone={toSign > 0 ? "danger" : "success"}
        />
        <StatCard
          index={1}
          label={t("cards.inEffect.label")}
          value={format.number(inEffect, "count")}
          hint={t("cards.inEffect.hint")}
        />
        <StatCard
          index={2}
          label={t("cards.drafts.label")}
          value={format.number(drafts, "count")}
          hint={t("cards.drafts.hint")}
          tone={drafts > 0 ? "warning" : "default"}
        />
      </section>

      <DataTable
        caption={t("caption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={<BookCheck />}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={isQuality(user) ? <NewSopButton /> : undefined}
          />
        }
      />
    </div>
  );
}
