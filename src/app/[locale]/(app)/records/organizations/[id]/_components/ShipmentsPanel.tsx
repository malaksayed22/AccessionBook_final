import { Truck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ShipmentStatusBadge } from "@/components/page/domain-badges";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import type { OrganizationShipmentRow } from "@/features/organization/queries";
import { EntityLink } from "@/components/page/EntityLink";

type Props = {
  headingId: string;
  title: string;
  emptyTitle: string;
  emptyBody: string;
  rows: OrganizationShipmentRow[];
  total: number;
  page: number;
  pageSize: number;
  buildHref: (page: number) => string;
};

/** One direction of shipments with this organization, a page at a time. */
export function ShipmentsPanel({
  headingId,
  title,
  emptyTitle,
  emptyBody,
  rows,
  total,
  page,
  pageSize,
  buildHref,
}: Props) {
  const t = useTranslations("organizations.detail.shipments");
  const format = useFormatter();

  const columns: Array<Column<OrganizationShipmentRow>> = [
    {
      id: "reference",
      header: t("columns.reference"),
      rowHeader: true,
      cell: (s) => (
        <EntityLink kind="shipment" id={s.id} className="font-mono">
          {s.reference}
        </EntityLink>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (s) => <ShipmentStatusBadge status={s.status} />,
    },
    {
      id: "date",
      header: t("columns.date"),
      cell: (s) => <time dateTime={s.date.toISOString()}>{format.dateTime(s.date, "date")}</time>,
    },
    {
      id: "lines",
      header: t("columns.lines"),
      align: "end",
      cell: (s) => (
        <EntityLink kind="shipment" id={s.id} className="tabular-nums">
          {format.number(s.lines, "count")}
        </EntityLink>
      ),
    },
    {
      id: "by",
      header: t("columns.recordedBy"),
      cell: (s) => (
        <EntityLink kind="member" id={s.recordedById}>
          {s.recordedBy}
        </EntityLink>
      ),
    },
  ];

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      <DataTable
        caption={title}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        empty={
          <EmptyState
            icon={<Truck />}
            title={emptyTitle}
            description={emptyBody}
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
