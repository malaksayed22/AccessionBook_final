import { Boxes } from "lucide-react";
import { useTranslations } from "next-intl";
import { UnitTypeBadge } from "@/components/page/domain-badges";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import type { OrganizationUnitRow } from "@/features/organization/queries";
import { EntityLink } from "@/components/page/EntityLink";

type Props = {
  rows: OrganizationUnitRow[];
  total: number;
  page: number;
  pageSize: number;
  buildHref: (page: number) => string;
};

/** Units exchanged with this organization: those it supplied, and those shipped to it. */
export function SuppliedUnitsPanel({ rows, total, page, pageSize, buildHref }: Props) {
  const t = useTranslations("organizations.detail.units");
  const domain = useTranslations("domain");

  const columns: Array<Column<OrganizationUnitRow>> = [
    {
      id: "name",
      header: t("columns.name"),
      rowHeader: true,
      cell: (u) => (
        <EntityLink kind="unit" id={u.id}>
          {u.name}
        </EntityLink>
      ),
    },
    { id: "type", header: t("columns.type"), cell: (u) => <UnitTypeBadge type={u.type} /> },
    {
      id: "relation",
      header: t("columns.relation"),
      cell: (u) => t(`relation.${u.relation}`),
    },
    {
      id: "cultivar",
      header: t("columns.cultivar"),
      cell: (u) =>
        u.cultivar ? (
          <EntityLink kind="cultivar" id={u.cultivar.id}>
            {u.cultivar.name}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "experiment",
      header: t("columns.experiment"),
      cell: (u) =>
        u.experiment ? (
          <EntityLink kind="experiment" id={u.experiment.id}>
            {u.experiment.ecode}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
  ];

  return (
    <section aria-labelledby="org-units">
      <h2 id="org-units" className="mb-3 text-lg font-semibold">
        {t("title")}
      </h2>
      <DataTable
        caption={t("title")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        empty={
          <EmptyState
            icon={<Boxes />}
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
