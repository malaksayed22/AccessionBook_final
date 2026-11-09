import { FlaskConical } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { EntityLink } from "@/components/page/EntityLink";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import type { OrganizationTestRow } from "@/features/organization/queries";
import { Link } from "@/i18n/navigation";

type Props = {
  rows: OrganizationTestRow[];
  total: number;
  page: number;
  pageSize: number;
  buildHref: (page: number) => string;
};

/** Lab results run by this organization, or run on material it supplied. */
export function TestsPanel({ rows, total, page, pageSize, buildHref }: Props) {
  const t = useTranslations("organizations.detail.tests");
  const domain = useTranslations("domain");
  const format = useFormatter();

  const columns: Array<Column<OrganizationTestRow>> = [
    {
      id: "unit",
      header: t("columns.unit"),
      rowHeader: true,
      cell: (r) => (
        <EntityLink kind="unit" id={r.unit.id}>
          {r.unit.name}
        </EntityLink>
      ),
    },
    {
      id: "test",
      header: t("columns.test"),
      cell: (r) => (
        <Link href="/quality?view=tests" className="text-accent-text hover:underline">
          {`${domain(`testPanel.${r.panel}`)}${r.analyte ? ` · ${r.analyte}` : ""}`}
        </Link>
      ),
    },
    {
      id: "value",
      header: t("columns.value"),
      align: "end",
      cell: (r) =>
        r.value === null ? (
          domain("empty")
        ) : (
          <span className="tabular-nums">
            {format.number(r.value, { maximumFractionDigits: 3 })}
            {r.uom ? ` ${r.uom}` : ""}
          </span>
        ),
    },
    { id: "relation", header: t("columns.relation"), cell: (r) => t(`relation.${r.relation}`) },
    {
      id: "date",
      header: t("columns.date"),
      cell: (r) => (
        <time dateTime={r.testedAt.toISOString()}>{format.dateTime(r.testedAt, "date")}</time>
      ),
    },
  ];

  return (
    <section aria-labelledby="org-tests">
      <h2 id="org-tests" className="mb-3 text-lg font-semibold">
        {t("title")}
      </h2>
      <DataTable
        caption={t("title")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<FlaskConical />}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            headingLevel={3}
          />
        }
      />
      <Pagination
        className="mt-4"
        page={page}
        pageSize={pageSize}
        total={total}
        buildHref={buildHref}
      />
    </section>
  );
}
