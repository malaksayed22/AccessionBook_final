export const dynamic = "force-dynamic";

import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuditActionBadge } from "@/components/AuditLabels";
import { EntityLink } from "@/components/page/EntityLink";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { auditEntityHref } from "@/features/audit/links";
import { recordIdParam } from "@/features/experiment/ids";
import { getExperimentLog, type ExperimentLogEntry } from "@/features/experiment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams } from "@/lib/list-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("experiments.log");
  return { title: t("pageTitle") };
}

/** The experiment's own log: its changes and those of its units and tasks, not the whole lab's. */
export default async function ExperimentLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const { id } = await params;
  const user = await requirePageUser();
  const experimentId = recordIdParam(id);
  if (!experimentId) notFound();
  const list = parseListParams(await searchParams, { sort: "date", order: "desc" });
  const log = await getExperimentLog(user, experimentId, list.page, list.limit);
  if (!log) notFound();

  const t = await getTranslations("experiments.log");
  const format = await getFormatter();
  const base = `/inventory/experiments/${log.experiment.id}`;

  const columns: Array<Column<ExperimentLogEntry>> = [
    {
      id: "when",
      header: t("when"),
      cell: (entry) => (
        <time dateTime={entry.at.toISOString()}>{format.dateTime(entry.at, "dateTime")}</time>
      ),
    },
    {
      id: "who",
      header: t("who"),
      cell: (entry) => (
        <EntityLink kind="member" id={entry.userId}>
          {entry.userName}
        </EntityLink>
      ),
    },
    {
      id: "record",
      header: t("record"),
      rowHeader: true,
      cell: (entry) => {
        const href = auditEntityHref(entry.entityType, entry.entityId);
        return href ? (
          <Link href={href} className="font-medium text-accent-text hover:underline">
            {entry.entityLabel}
          </Link>
        ) : (
          entry.entityLabel
        );
      },
    },
    {
      id: "action",
      header: t("action"),
      cell: (entry) => <AuditActionBadge action={entry.action} linked={false} />,
    },
    {
      id: "summary",
      header: t("summary"),
      cell: (entry) => <span className="wrap-break-word">{entry.summary}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <HubCrumbs
            tab="experiments"
            trail={[{ label: log.experiment.ecode, href: base }]}
            kind="log"
          />
        }
        title={t("title", { code: log.experiment.ecode })}
        description={t("description", { name: log.experiment.name })}
        actions={
          <Button href={base} variant="secondary">
            {t("back")}
          </Button>
        }
      />
      <DataTable
        clientPaging={false}
        caption={t("caption", { code: log.experiment.ecode })}
        captionHidden
        columns={columns}
        rows={log.rows}
        rowKey={(entry) => entry.id}
        empty={
          <EmptyState
            icon={<ScrollText />}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            headingLevel={2}
          />
        }
      />
      <Pagination
        className="mt-4"
        page={list.page}
        pageSize={list.limit}
        total={log.total}
        buildHref={(page) => buildListUrl(`${base}/log`, { limit: list.limit }, { page })}
      />
    </div>
  );
}
