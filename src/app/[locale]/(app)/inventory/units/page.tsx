export const dynamic = "force-dynamic";

import { Boxes, Download } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { DonutChart, type DonutSlice } from "@/components/charts/DonutChart";
import { STATUS } from "@/components/charts/palette";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { EntityLink } from "@/components/page/EntityLink";
import { SelectFilter } from "@/components/page/SelectFilter";
import { UnitStatusBadge, UnitTypeBadge } from "@/components/page/domain-badges";
import { ColumnsMenu, SavedViewsMenu } from "@/components/TableViewMenus";
import { BulkBar, BulkProvider, RowSelect, SelectAll } from "@/components/unit/BulkSelection";
import { Button, buttonStyles } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Pagination } from "@/components/ui/Pagination";
import {
  getUnitStatusCounts,
  listLocationOptions,
  listUnits,
  UNIT_LIST_GROUPS,
  UNIT_LIST_SORTS,
  UNIT_LIST_STAGES,
  UNIT_LIST_STATUSES,
  type UnitListRow,
} from "@/features/unit/queries";
import { listViews } from "@/features/view/service";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam, positiveIntParam } from "@/lib/list-params";
import { canManageLocations, destroysUnits, isQuality, isReadOnly } from "@/lib/roles";
import { CreateUnitsButtons } from "@/components/actions/CreateUnitsButtons";
import { hiddenColumns, normalizeViewQuery } from "@/lib/table-view";

const BASE = "/inventory/units";
const TYPES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;
/** Columns a member may hide; the selection box and the unit's name always show. */
const OPTIONAL_COLUMNS = [
  "type",
  "cultivar",
  "experiment",
  "location",
  "left",
  "updated",
  "status",
] as const;

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("units.list");
  return { title: t("pageTitle") };
}

/** The status colours, as on the dashboard's "Units by status". */
const STATUS_COLOUR = {
  active: STATUS.good,
  hold: STATUS.caution,
  empty: STATUS.neutral,
  destroyed: STATUS.bad,
} as const;

export default async function UnitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("units.list");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const list = parseListParams(raw, { sort: "date", order: "desc" });
  const sort = pickParam(list.sort, UNIT_LIST_SORTS) ?? "date";
  const status = pickParam(raw.status, UNIT_LIST_STATUSES);
  const type = pickParam(raw.type, TYPES);
  const stage = pickParam(raw.stage, UNIT_LIST_STAGES);
  const locationId = positiveIntParam(raw.location);
  const group = pickParam(raw.group, UNIT_LIST_GROUPS);
  const hidden = hiddenColumns(raw.hide, OPTIONAL_COLUMNS);

  const [{ rows, total }, locations, counts, moveTargets, views] = await Promise.all([
    listUnits(user, {
      q: list.q,
      type,
      status,
      locationId,
      stage,
      group,
      sort,
      order: list.order,
      page: list.page,
      limit: list.limit,
    }),
    listLocationOptions(locationId),
    getUnitStatusCounts(user, { q: list.q, type, stage, locationId }),
    listLocationOptions(),
    listViews(user, "units"),
  ]);

  const current = {
    q: list.q,
    status,
    type,
    stage,
    location: locationId,
    sort,
    order: list.order,
    group,
    hide: hidden.join(",") || undefined,
  };
  // The list's query without the page: what the column menu changes and a saved view keeps.
  const query = buildListUrl(BASE, current).split("?")[1] ?? "";
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || status || type || stage || locationId);

  const groupKey = (u: UnitListRow) =>
    group === "type"
      ? u.type
      : group === "cultivar"
        ? String(u.cultivarId ?? "")
        : group === "experiment"
          ? String(u.experiment?.id ?? "")
          : String(u.locationId ?? "");
  const groupLabel = (u: UnitListRow) =>
    group === "type"
      ? domain(`unitTypePlural.${u.type}`)
      : group === "cultivar"
        ? (u.cultivarName ?? t("groupEmpty.cultivar"))
        : group === "experiment"
          ? (u.experiment?.ecode ?? t("groupEmpty.experiment"))
          : (u.locationName ?? t("groupEmpty.location"));

  /** What is in stock: grams for flower, seeds for a seed lot, one organism for a plant or culture. */
  const leftText = (u: UnitListRow): string => {
    if (u.status === "destroyed" || u.nothingLeft) return format.number(0, "count");
    if (u.type === "FLOWER") {
      if (u.left.dryGrams !== null) return t("left.gramsDry", { grams: u.left.dryGrams });
      if (u.left.wetGrams !== null) return t("left.gramsWet", { grams: u.left.wetGrams });
      return t("left.notWeighed");
    }
    if (u.type === "SEEDLOT") {
      return u.left.seeds === null ? domain("empty") : t("left.seeds", { count: u.left.seeds });
    }
    return format.number(1, "count");
  };

  const allColumns: Array<Column<UnitListRow>> = [
    {
      id: "select",
      header: <SelectAll />,
      cell: (u) => <RowSelect id={u.id} name={u.name} />,
    },
    {
      id: "code",
      header: t("columns.code"),
      cell: (u) => (
        <Link
          href={`/inventory/units/${u.id}`}
          className="font-mono text-sm text-accent-text tabular-nums hover:underline"
        >
          {u.code}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("columns.name"),
      sortKey: "name",
      rowHeader: true,
      cell: (u) => (
        <Link
          href={`/inventory/units/${u.id}`}
          className="font-medium text-accent-text hover:underline"
        >
          {u.name}
        </Link>
      ),
    },
    {
      id: "type",
      header: t("columns.type"),
      sortKey: "type",
      cell: (u) => <UnitTypeBadge type={u.type} />,
    },
    {
      id: "cultivar",
      header: t("columns.cultivar"),
      sortKey: "cultivar",
      cell: (u) => (
        <EntityLink kind="cultivar" id={u.cultivarId}>
          {u.cultivarName ?? domain("empty")}
        </EntityLink>
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
    {
      id: "location",
      header: t("columns.location"),
      sortKey: "location",
      cell: (u) => (
        <EntityLink kind="location" id={u.locationId}>
          {u.locationName ?? domain("empty")}
        </EntityLink>
      ),
    },
    {
      id: "left",
      header: t("columns.left"),
      align: "end",
      cell: (u) => <span className="tabular-nums whitespace-nowrap">{leftText(u)}</span>,
    },
    {
      id: "updated",
      header: t("columns.updated"),
      sortKey: "date",
      // The day keeps the column narrow; the exact time is one hover away.
      cell: (u) => (
        <time
          dateTime={u.lastUpdated.toISOString()}
          title={format.dateTime(u.lastUpdated, "dateTime")}
          className="whitespace-nowrap"
        >
          {format.dateTime(u.lastUpdated, "date")}
        </time>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (u) => <UnitStatusBadge status={u.status} nothingLeft={u.nothingLeft} />,
    },
  ];
  const columns = allColumns.filter((column) => !hidden.includes(column.id));
  const optionalColumns = allColumns.flatMap((column) =>
    (OPTIONAL_COLUMNS as readonly string[]).includes(column.id)
      ? [{ id: column.id, label: String(column.header) }]
      : []
  );

  const statusSlices: DonutSlice[] = UNIT_LIST_STATUSES.map((key) => ({
    key,
    label: t(`statusOptions.${key}`),
    value: counts[key],
    gradient: STATUS_COLOUR[key],
    href: href({ status: status === key ? undefined : key }),
  }));
  const statusTotal = statusSlices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description", { count: total })}
        actions={
          <>
            {isReadOnly(user) ? null : <CreateUnitsButtons />}
            {/* A file download from the API, not a page of the app: a plain link, no language prefix. */}
            <a
              href={`/api/units/export?${new URLSearchParams(
                Object.entries(current).flatMap(([key, value]) =>
                  value === undefined || value === null || value === ""
                    ? []
                    : [[key, String(value)]]
                )
              ).toString()}`}
              className={buttonStyles({ variant: "secondary" })}
            >
              <Download aria-hidden="true" className="size-4" />
              {t("exportCsv")}
            </a>
          </>
        }
      />

      {/* One chart instead of a card per status; a status in the legend filters the list by it. */}
      {statusTotal > 0 ? (
        <section aria-label={t("cards.heading")} className="mb-6 lg:max-w-2xl">
          <Panel className="chart-glow">
            <PanelHeader title={t("cards.heading")} headingLevel={2} />
            <PanelBody>
              <DonutChart
                label={t("cards.heading")}
                slices={statusSlices}
                centerValue={format.number(statusTotal, "count")}
                centerLabel={t("cards.center")}
              />
            </PanelBody>
          </Panel>
        </section>
      ) : null}

      <FilterBar
        search={
          <SearchForm
            action={BASE}
            params={current}
            q={list.q}
            label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
          />
        }
        controls={
          <>
            <SelectFilter
              label={t("locationLabel")}
              value={locationId ? String(locationId) : "all"}
              options={[
                { value: "all", label: t("allLocations"), href: href({ location: undefined }) },
                ...locations.map((l) => ({
                  value: String(l.id),
                  label: l.name,
                  href: href({ location: l.id }),
                })),
              ]}
            />
            <SelectFilter
              label={t("group")}
              value={group ?? "none"}
              options={[
                { value: "none", label: t("groups.none"), href: href({ group: undefined }) },
                ...UNIT_LIST_GROUPS.map((key) => ({
                  value: key,
                  label: t(`groups.${key}`),
                  href: href({ group: key }),
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
                list="units"
                state={{ base: BASE, query }}
                views={views}
                current={normalizeViewQuery(query)}
              />
            </div>
          </>
        }
      >
        <FilterChips
          label={t("statusLabel")}
          clearHref={filtered ? BASE : undefined}
          chips={UNIT_LIST_STATUSES.map((key) => ({
            key,
            label: t(`statusOptions.${key}`),
            active: status === key,
            href: href({ status: status === key ? undefined : key }),
          }))}
        />
        <FilterChips
          label={t("stageLabel")}
          chips={UNIT_LIST_STAGES.map((key) => ({
            key,
            label: domain(`growthStage.${key}`),
            active: stage === key,
            href: href({ stage: stage === key ? undefined : key }),
          }))}
        />
        <FilterChips
          label={t("typeLabel")}
          chips={TYPES.map((key) => ({
            key,
            label: domain(`unitTypePlural.${key}`),
            active: type === key,
            href: href({ type: type === key ? undefined : key }),
          }))}
        />
      </FilterBar>

      <BulkProvider
        units={rows.map((u) => ({
          id: u.id,
          name: u.name,
          type: u.type,
          status: u.status,
          nothingLeft: u.nothingLeft,
          locationId: u.locationId,
          growthStage: u.growthStage,
        }))}
        locations={moveTargets}
        canAddLocation={canManageLocations(user)}
        canDestroy={destroysUnits(user)}
        canRelease={isQuality(user)}
      >
        <DataTable
          clientPaging={false}
          caption={t("caption")}
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          groupBy={group ? { key: groupKey, label: groupLabel } : undefined}
          sort={{ sort, order: list.order }}
          buildSortHref={(key, order) => href({ sort: key, order })}
          empty={
            filtered ? (
              <EmptyState
                icon={<Boxes />}
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
                icon={<Boxes />}
                title={t("emptyTitle")}
                description={t("emptyBody")}
                action={
                  <Button href="/inventory/experiments" variant="primary">
                    {t("emptyAction")}
                  </Button>
                }
              />
            )
          }
        />
        <BulkBar />
      </BulkProvider>
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
