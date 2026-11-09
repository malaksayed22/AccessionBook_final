export const dynamic = "force-dynamic";

import { ArrowDownLeft, ArrowUpRight, Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { MaterialTotalsText } from "@/components/MaterialFigures";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { FilterBar } from "@/components/page/FilterBar";
import { ColumnsMenu, SavedViewsMenu } from "@/components/TableViewMenus";
import { RegisterSearchForm } from "@/components/RegisterSearchForm";
import { EntityLink } from "@/components/page/EntityLink";
import { SelectFilter } from "@/components/page/SelectFilter";
import { ShipmentStatusBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import {
  getShipmentFormOptions,
  getShipmentStats,
  listShipments,
  SHIPMENT_LIST_DIRECTIONS,
  SHIPMENT_LIST_SORTS,
  SHIPMENT_LIST_STATUSES,
  type ShipmentListRow,
} from "@/features/shipment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { hiddenColumns, normalizeViewQuery } from "@/lib/table-view";
import { listViews } from "@/features/view/service";
import { dayParam, orderedRange } from "@/lib/date-filter";
import { buildListUrl, parseListParams, pickParam, positiveIntParam } from "@/lib/list-params";

const BASE = "/inventory/materials";

/** Columns a member may hide; the shipment's reference always shows. */
const OPTIONAL_COLUMNS = [
  "direction",
  "organization",
  "date",
  "material",
  "tracking",
  "status",
] as const;

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("materials.list");
  return { title: t("pageTitle") };
}

/** Status colours: draft is not yet anything, in transit is under way, cancelled went nowhere. */
const SHIPMENT_STATUS_COLOUR = {
  DRAFT: STATUS.neutral,
  IN_TRANSIT: STATUS.caution,
  DELIVERED: STATUS.good,
  CANCELLED: STATUS.bad,
} as const;

export default async function MaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("materials.list");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const list = parseListParams(raw, { sort: "date", order: "desc" });
  const sort = pickParam(list.sort, SHIPMENT_LIST_SORTS) ?? "date";
  const direction = pickParam(raw.direction, SHIPMENT_LIST_DIRECTIONS);
  const status = pickParam(raw.status, SHIPMENT_LIST_STATUSES);
  const organizationId = positiveIntParam(raw.organization);
  const { from, to } = orderedRange(dayParam(raw.from), dayParam(raw.to));

  const filters = { q: list.q, direction, status, organizationId, from, to };
  const hidden = hiddenColumns(raw.hide, OPTIONAL_COLUMNS);
  const [{ rows, total }, stats, options, views] = await Promise.all([
    listShipments(user, {
      ...filters,
      sort,
      order: list.order,
      page: list.page,
      limit: list.limit,
    }),
    getShipmentStats(user, filters),
    getShipmentFormOptions(),
    listViews(user, "shipments"),
  ]);

  const current = {
    q: list.q,
    direction,
    status,
    organization: organizationId,
    from,
    to,
    sort,
    order: list.order,
    hide: hidden.join(",") || undefined,
  };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  // The list's query without the page: what the column menu changes and a saved view keeps.
  const query = buildListUrl(BASE, current).split("?")[1] ?? "";
  const filtered = Boolean(list.q || direction || status || organizationId || from || to);
  const admin = isAdmin(user);

  const allColumns: Array<Column<ShipmentListRow>> = [
    {
      id: "reference",
      header: t("columns.reference"),
      sortKey: "reference",
      rowHeader: true,
      cell: (s) => (
        <EntityLink kind="shipment" id={s.id}>
          {s.reference}
        </EntityLink>
      ),
    },
    {
      id: "direction",
      header: t("columns.direction"),
      sortKey: "direction",
      cell: (s) => (
        <Badge
          tone={s.direction === "INBOUND" ? "info" : "accent"}
          icon={s.direction === "INBOUND" ? <ArrowDownLeft /> : <ArrowUpRight />}
          href={`${BASE}?direction=${s.direction}`}
        >
          {domain(`shipmentDirection.${s.direction}`)}
        </Badge>
      ),
    },
    {
      id: "organization",
      header: t("columns.organization"),
      sortKey: "organization",
      cell: (s) => (
        <EntityLink kind="organization" id={s.organization.id}>
          {s.organization.name}
        </EntityLink>
      ),
    },
    {
      id: "date",
      header: t("columns.date"),
      sortKey: "date",
      cell: (s) => (
        <time dateTime={s.movementDate.toISOString()}>
          {format.dateTime(s.movementDate, "date")}
        </time>
      ),
    },
    {
      id: "material",
      header: t("columns.material"),
      cell: (s) => (
        <>
          <MaterialTotalsText totals={s.totals} />
          <span className="block text-fg-secondary">{t("lines", { count: s.lineCount })}</span>
        </>
      ),
    },
    {
      id: "tracking",
      header: t("columns.tracking"),
      cell: (s) => s.trackingNumber ?? domain("empty"),
    },
    {
      id: "status",
      header: t("columns.status"),
      sortKey: "status",
      cell: (s) => <ShipmentStatusBadge status={s.status} />,
    },
  ];
  const columns = allColumns.filter((column) => !hidden.includes(column.id));
  const optionalColumns = allColumns.flatMap((column) =>
    (OPTIONAL_COLUMNS as readonly string[]).includes(column.id)
      ? [{ id: column.id, label: String(column.header) }]
      : []
  );

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description", { count: total })}
        actions={
          admin ? (
            <Button href="/inventory/materials/new" variant="primary" icon={<Plus />}>
              {t("newMovement")}
            </Button>
          ) : null
        }
      />

      <StatusDonut
        title={t("stats.chartTitle")}
        slices={(["DRAFT", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const).map((key) => ({
          key,
          label: domain(`shipmentStatus.${key}`),
          value: stats.byStatus[key],
          gradient: SHIPMENT_STATUS_COLOUR[key],
          href: href({ status: status === key ? undefined : key }),
        }))}
        centerValue={format.number(
          Object.values(stats.byStatus).reduce((sum, n) => sum + n, 0),
          "count"
        )}
        centerLabel={t("stats.chartCenter")}
        footer={
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              {t("stats.received")}: <MaterialTotalsText totals={stats.received.totals} />
            </span>
            <span>
              {t("stats.shipped")}: <MaterialTotalsText totals={stats.shipped.totals} />
            </span>
          </p>
        }
      />

      <FilterBar
        search={
          <RegisterSearchForm
            action={BASE}
            params={current}
            q={list.q}
            from={from}
            to={to}
            label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
            fromLabel={t("dateFrom")}
            toLabel={t("dateTo")}
          />
        }
        controls={
          <>
            <SelectFilter
              label={t("organizationLabel")}
              value={organizationId ? String(organizationId) : "all"}
              options={[
                {
                  value: "all",
                  label: t("allOrganizations"),
                  href: href({ organization: undefined }),
                },
                ...options.organizations.map((org) => ({
                  value: String(org.id),
                  label: org.name,
                  href: href({ organization: org.id }),
                })),
              ]}
            />
            <div className="flex flex-wrap items-center gap-2">
              <ColumnsMenu
                state={{ base: BASE, query }}
                columns={optionalColumns}
                hidden={hidden}
              />
              <SavedViewsMenu
                list="shipments"
                state={{ base: BASE, query }}
                views={views}
                current={normalizeViewQuery(query)}
              />
            </div>
          </>
        }
      >
        <FilterChips
          label={t("directionLabel")}
          clearHref={filtered ? BASE : undefined}
          chips={SHIPMENT_LIST_DIRECTIONS.map((key) => ({
            key,
            label: domain(`shipmentDirection.${key}`),
            active: direction === key,
            href: href({ direction: direction === key ? undefined : key }),
          }))}
        />
        <FilterChips
          label={t("statusLabel")}
          chips={SHIPMENT_LIST_STATUSES.map((key) => ({
            key,
            label: domain(`shipmentStatus.${key}`),
            active: status === key,
            href: href({ status: status === key ? undefined : key }),
          }))}
        />
      </FilterBar>

      <DataTable
        clientPaging={false}
        caption={t("caption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        sort={{ sort, order: list.order }}
        buildSortHref={(key, order) => href({ sort: key, order })}
        empty={
          filtered ? (
            <EmptyState
              icon={<Truck />}
              title={t("noMatchTitle")}
              description={t("noMatchBody")}
              action={
                <Button href={BASE} variant="secondary">
                  {t("clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Truck />}
              title={t("emptyTitle")}
              description={t("emptyBody")}
              action={
                admin ? (
                  <Button href="/inventory/materials/new" variant="primary">
                    {t("emptyAction")}
                  </Button>
                ) : undefined
              }
            />
          )
        }
      />
      <Pagination
        className="mt-4"
        page={list.page}
        pageSize={list.limit}
        total={total}
        buildHref={(page) => buildListUrl(BASE, { ...current, limit: list.limit }, { page })}
      />
    </div>
  );
}
