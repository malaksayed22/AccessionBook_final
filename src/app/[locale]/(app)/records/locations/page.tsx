export const dynamic = "force-dynamic";

import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { EntityLink, entityHref } from "@/components/page/EntityLink";
import { LocationOccupancy } from "@/components/LocationOccupancy";
import { LocationRowActions } from "@/components/LocationRowActions";
import { NewLocationButton } from "@/components/NewLocationButton";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { SelectFilter } from "@/components/page/SelectFilter";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import {
  getLocationOverview,
  listLocations,
  LOCATION_LIST_SORTS,
  LOCATION_LIST_STATUSES,
  type LocationListRow,
  type LocationListSort,
} from "@/features/location/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";
import { canManageLocations } from "@/lib/roles";

const BASE = "/records/locations";
const VIEWS = ["cards", "table"] as const;

/** The sort choices offered in both views, as "sort:order" so one select covers both. */
const SORT_CHOICES: Array<{ sort: LocationListSort; order: "asc" | "desc" }> = [
  { sort: "name", order: "asc" },
  { sort: "name", order: "desc" },
  { sort: "units", order: "desc" },
  { sort: "units", order: "asc" },
  { sort: "capacity", order: "desc" },
  { sort: "capacity", order: "asc" },
];

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("locations.list");
  return { title: t("pageTitle") };
}

export default async function LocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("locations");
  const format = await getFormatter();
  const domain = await getTranslations("domain");
  const canManage = canManageLocations(user);

  const list = parseListParams(raw, { sort: "name", order: "asc" });
  const sort = pickParam(list.sort, LOCATION_LIST_SORTS) ?? "name";
  const status = pickParam(raw.status, LOCATION_LIST_STATUSES);
  const view = pickParam(raw.view, VIEWS) ?? "cards";

  const [{ rows, total }, overview] = await Promise.all([
    listLocations(user, {
      q: list.q,
      status,
      sort,
      order: list.order,
      page: list.page,
      limit: list.limit,
    }),
    getLocationOverview(user),
  ]);

  const current = {
    q: list.q,
    status,
    sort,
    order: list.order,
    view: view === "cards" ? undefined : view,
  };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || status);

  const capacityText = (l: LocationListRow) =>
    l.capacity === null
      ? t("list.noLimit")
      : l.capacityMeasure === "WEIGHT"
        ? t("list.capacityWeight", { kg: l.capacity / 1000 })
        : t(l.capacityMeasure === "PLANTS" ? "list.capacityPlants" : "list.capacityUnits", {
            count: l.capacity,
          });
  /** What the occupancy meter counts: plants, grams or units, as the room's capacity is set. */
  const occupied = (l: LocationListRow) =>
    l.capacityMeasure === "PLANTS" ? l.plants : l.capacityMeasure === "WEIGHT" ? l.grams : l.units;
  const statusBadge = (l: LocationListRow) => (
    <Badge
      tone={l.active ? "success" : "neutral"}
      href={buildListUrl(BASE, { status: l.active ? "active" : "retired" })}
    >
      {t(`status.${l.active ? "active" : "retired"}`)}
    </Badge>
  );
  const rowActions = (l: LocationListRow) => (
    <LocationRowActions
      location={{
        id: l.id,
        name: l.name,
        code: l.code,
        address: l.address,
        comment: l.comment,
        capacity: l.capacity,
        capacityMeasure: l.capacityMeasure,
        active: l.active,
        units: l.units,
      }}
    />
  );

  const columns: Array<Column<LocationListRow>> = [
    {
      id: "code",
      header: t("list.columns.code"),
      cell: (l) => (
        <span className="font-mono text-sm tabular-nums">{l.code ?? domain("empty")}</span>
      ),
    },
    {
      id: "name",
      header: t("list.columns.name"),
      sortKey: "name",
      rowHeader: true,
      cell: (l) => (
        <div className="min-w-0">
          <EntityLink kind="location" id={l.id}>
            {l.name}
          </EntityLink>
          {l.comment ? (
            <p className="mt-0.5 line-clamp-2 text-sm font-normal text-fg-secondary">{l.comment}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: t("list.columns.status"),
      cell: statusBadge,
    },
    {
      id: "units",
      header: t("list.columns.units"),
      sortKey: "units",
      align: "end",
      cell: (l) => (
        <EntityLink kind="location" id={l.id} className="tabular-nums">
          {format.number(l.units, "count")}
        </EntityLink>
      ),
    },
    {
      id: "capacity",
      header: t("list.columns.capacity"),
      sortKey: "capacity",
      align: "end",
      cell: (l) => (
        <span className={l.capacity === null ? "text-fg-secondary" : "tabular-nums"}>
          {capacityText(l)}
        </span>
      ),
    },
    {
      id: "occupancy",
      header: t("list.columns.occupancy"),
      cell: (l) => (
        <LocationOccupancy
          name={l.name}
          units={occupied(l)}
          capacity={l.capacity}
          measure={l.capacityMeasure}
          href={entityHref("location", l.id)}
        />
      ),
    },
    {
      id: "experiments",
      header: t("list.columns.experiments"),
      align: "end",
      cell: (l) => (
        <Link
          href="/inventory/experiments"
          className="text-accent-text tabular-nums hover:underline"
        >
          {format.number(l.experiments, "count")}
        </Link>
      ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: t("list.columns.actions"),
            hideHeader: true,
            align: "end" as const,
            cell: rowActions,
          },
        ]
      : []),
  ];

  const empty = filtered ? (
    <EmptyState
      icon={<MapPin />}
      title={t("list.noMatchTitle")}
      description={t("list.noMatchBody")}
      action={
        <Button href={BASE} variant="secondary">
          {t("list.clearFilters")}
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<MapPin />}
      title={t("list.emptyTitle")}
      description={canManage ? t("list.emptyBody") : t("list.emptyBodyMember")}
      action={canManage ? <NewLocationButton /> : undefined}
    />
  );

  return (
    <div>
      <PageHeader
        title={t("list.title")}
        description={t("list.description", { count: total })}
        actions={canManage ? <NewLocationButton /> : null}
      />

      <StatusDonut
        title={t("stats.chartTitle")}
        slices={[
          {
            key: "available",
            label: t("stats.available"),
            value: Math.max(overview.active - overview.atCapacity, 0),
            gradient: STATUS.good,
            href: href({ status: status === "active" ? undefined : "active" }),
          },
          {
            key: "full",
            label: t("stats.atCapacity"),
            value: overview.atCapacity,
            gradient: STATUS.caution,
          },
          {
            key: "retired",
            label: t("stats.retired"),
            value: overview.retired,
            gradient: STATUS.neutral,
            href: href({ status: status === "retired" ? undefined : "retired" }),
          },
        ]}
        centerValue={format.number(overview.active + overview.retired, "count")}
        centerLabel={t("stats.chartCenter")}
        footer={
          <Link href="/inventory/units" className="hover:text-accent-text hover:underline">
            {t("stats.unitsLine", { count: overview.unitsStored })}
          </Link>
        }
      />

      <FilterBar
        search={
          <SearchForm
            action={BASE}
            params={current}
            q={list.q}
            label={t("list.searchLabel")}
            placeholder={t("list.searchPlaceholder")}
          />
        }
        controls={
          <>
            <SelectFilter
              label={t("list.sortLabel")}
              value={`${sort}:${list.order}`}
              options={SORT_CHOICES.map((choice) => ({
                value: `${choice.sort}:${choice.order}`,
                label: t(`list.sortOptions.${choice.sort}_${choice.order}`),
                href: href({ sort: choice.sort, order: choice.order }),
              }))}
            />
            <ViewModeToggle basePath={BASE} params={current} activeView={view} />
          </>
        }
      >
        <FilterChips
          label={t("list.statusLabel")}
          clearHref={filtered ? BASE : undefined}
          chips={LOCATION_LIST_STATUSES.map((key) => ({
            key,
            label: t(`status.${key}`),
            active: status === key,
            href: href({ status: status === key ? undefined : key }),
          }))}
        />
      </FilterBar>

      {view === "table" ? (
        <DataTable
          caption={t("list.caption")}
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          sort={{ sort, order: list.order }}
          buildSortHref={(key, order) => href({ sort: key, order })}
          empty={empty}
        />
      ) : rows.length === 0 ? (
        <Panel>{empty}</Panel>
      ) : (
        <section aria-labelledby="location-cards">
          <h2 id="location-cards" className="sr-only">
            {t("list.caption")}
          </h2>
          <ul className="-mb-4 grid gap-x-4 gap-y-0 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((l) => (
              <li key={l.id} className="row-span-4 mb-4 grid grid-rows-subgrid gap-y-0">
                {/* The whole card opens the room: the name link is stretched over it, and the
                    badge, the experiments link and the actions menu sit above it. */}
                <article className="relative row-span-4 grid h-full grid-rows-subgrid gap-y-0 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors duration-150 hover:border-border-strong hover:bg-hover motion-reduce:transition-none has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus">
                  <div className="row-start-1 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-fg wrap-break-word">
                        <Link
                          href={entityHref("location", l.id)}
                          className="flex items-center gap-2 outline-none after:absolute after:inset-0 after:rounded-xl"
                        >
                          <MapPin aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
                          {l.name}
                        </Link>
                      </h3>
                      {l.code ? (
                        <p className="mt-0.5 font-mono text-sm text-fg-secondary tabular-nums">
                          {l.code}
                        </p>
                      ) : null}
                    </div>
                    <div className="relative z-10 flex shrink-0 items-center gap-1">
                      {statusBadge(l)}
                      {canManage ? rowActions(l) : null}
                    </div>
                  </div>

                  {l.comment ? (
                    <p className="row-start-2 line-clamp-2 pt-4 text-sm text-fg-secondary">
                      {l.comment}
                    </p>
                  ) : null}

                  <LocationOccupancy
                    className="row-start-3 content-start pt-4"
                    name={l.name}
                    units={occupied(l)}
                    capacity={l.capacity}
                    measure={l.capacityMeasure}
                  />

                  <dl className="row-start-4 grid grid-cols-[auto_auto_auto] content-end justify-between gap-x-4 gap-y-2 pt-4 text-sm">
                    <div>
                      <dt className="text-fg-secondary">{t("list.columns.units")}</dt>
                      <dd className="font-medium tabular-nums">
                        {format.number(l.units, "count")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-secondary">{t("list.columns.capacity")}</dt>
                      <dd className="font-medium tabular-nums">{capacityText(l)}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-secondary">{t("list.columns.experiments")}</dt>
                      <dd className="font-medium tabular-nums">
                        <Link
                          href="/inventory/experiments"
                          className="relative z-10 text-accent-text hover:underline"
                        >
                          {format.number(l.experiments, "count")}
                        </Link>
                      </dd>
                    </div>
                  </dl>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
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
