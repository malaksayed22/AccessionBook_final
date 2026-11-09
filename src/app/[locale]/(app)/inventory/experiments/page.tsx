export const dynamic = "force-dynamic";

import { FlaskConical, Plus } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExperimentCard } from "@/components/experiment/ExperimentCard";
import { EntityLink } from "@/components/page/EntityLink";
import { ExperimentStatusBadge } from "@/components/experiment/ExperimentStatusBadge";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { SelectFilter } from "@/components/page/SelectFilter";
import { ColumnsMenu, SavedViewsMenu } from "@/components/TableViewMenus";
import { ViewModeToggle, parseViewMode } from "@/components/ViewModeToggle";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { CALENDAR_DAY_FORMAT } from "@/features/experiment/dates";
import {
  EXPERIMENT_LIST_SORTS,
  EXPERIMENT_LIST_STATUSES,
  listExperiments,
  type ExperimentListRow,
} from "@/features/experiment/queries";
import { listViews } from "@/features/view/service";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";
import { seesWholeLab } from "@/lib/roles";
import { hiddenColumns, normalizeViewQuery } from "@/lib/table-view";

const BASE = "/inventory/experiments";
/** Columns of the table view a member may hide; the code and name always show. */
const OPTIONAL_COLUMNS = [
  "status",
  "started",
  "completed",
  "estimated",
  "units",
  "team",
  "parent",
] as const;

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("experiments.list");
  return { title: t("pageTitle") };
}

export default async function ExperimentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("experiments.list");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const list = parseListParams(raw, { sort: "date", order: "desc" });
  const sort = pickParam(list.sort, EXPERIMENT_LIST_SORTS) ?? "date";
  const status = pickParam(raw.status, EXPERIMENT_LIST_STATUSES);
  const admin = isAdmin(user);
  // A member only ever sees their own experiments, so the filter is for administrators.
  const mine = seesWholeLab(user) && raw.mine === "1";
  const view = parseViewMode(raw.view);
  const hidden = hiddenColumns(raw.hide, OPTIONAL_COLUMNS);

  const [{ rows, total }, views] = await Promise.all([
    listExperiments(user, {
      q: list.q,
      status,
      mine,
      sort,
      order: list.order,
      page: list.page,
      limit: list.limit,
    }),
    listViews(user, "experiments"),
  ]);

  const current = {
    q: list.q,
    status,
    mine: mine ? "1" : undefined,
    sort,
    order: list.order,
    view: view === "cards" ? undefined : view,
    limit: raw.limit ? list.limit : undefined,
    hide: hidden.join(",") || undefined,
  };
  // The list's query without the page: what the column menu changes and a saved view keeps.
  const query = buildListUrl(BASE, current).split("?")[1] ?? "";
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || status || mine);

  const sortOptions = EXPERIMENT_LIST_SORTS.flatMap((key) =>
    (["asc", "desc"] as const).map((order) => ({
      value: `${key}:${order}`,
      label: t(`sortOptions.${key}-${order}`),
      href: href({ sort: key, order }),
    }))
  );

  const allColumns: Array<Column<ExperimentListRow>> = [
    {
      id: "code",
      header: t("columns.code"),
      sortKey: "code",
      rowHeader: true,
      cell: (e) => (
        <Link
          href={`/inventory/experiments/${e.id}`}
          className="font-mono font-semibold text-accent-text hover:underline"
        >
          {e.ecode}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("columns.name"),
      sortKey: "name",
      cell: (e) => (
        <EntityLink kind="experiment" id={e.id}>
          {e.name}
        </EntityLink>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (e) => <ExperimentStatusBadge status={e.status} />,
    },
    {
      id: "started",
      header: t("columns.started"),
      sortKey: "date",
      cell: (e) => (
        <span className="whitespace-nowrap">
          {format.dateTime(e.startDate, CALENDAR_DAY_FORMAT)}
        </span>
      ),
    },
    {
      id: "completed",
      header: t("columns.completed"),
      sortKey: "end",
      cell: (e) => (
        <span className="whitespace-nowrap">
          {e.endDate ? format.dateTime(e.endDate, CALENDAR_DAY_FORMAT) : domain("empty")}
        </span>
      ),
    },
    {
      id: "estimated",
      header: t("columns.estimated"),
      cell: (e) => (
        <span className="whitespace-nowrap">
          {e.endDate || !e.estimatedEndDate
            ? domain("empty")
            : format.dateTime(e.estimatedEndDate, CALENDAR_DAY_FORMAT)}
        </span>
      ),
    },
    {
      id: "units",
      header: t("columns.units"),
      sortKey: "units",
      align: "end",
      cell: (e) => (
        <Link
          href={`/inventory/experiments/${e.id}#units`}
          className="tabular-nums text-accent-text hover:underline"
        >
          {t("unitsInInventory", { inventory: e.stats.active, total: e.unitCount })}
        </Link>
      ),
    },
    {
      id: "team",
      header: t("columns.team"),
      cell: (e) =>
        e.members.length > 0
          ? e.members.map((m, index) => (
              <span key={m.userId}>
                {index > 0 ? ", " : null}
                <EntityLink kind="member" id={m.userId}>
                  {m.name}
                </EntityLink>
              </span>
            ))
          : domain("empty"),
    },
    {
      id: "parent",
      header: t("columns.parent"),
      cell: (e) =>
        e.parent ? (
          <EntityLink kind="experiment" id={e.parent.id} className="font-mono">
            {e.parent.ecode}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
  ];
  const columns = allColumns.filter((column) => !hidden.includes(column.id));
  const optionalColumns = allColumns.flatMap((column) =>
    (OPTIONAL_COLUMNS as readonly string[]).includes(column.id)
      ? [{ id: column.id, label: String(column.header) }]
      : []
  );

  const empty = filtered ? (
    <EmptyState
      icon={<FlaskConical />}
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
      icon={<FlaskConical />}
      title={t("emptyTitle")}
      description={t("emptyBody")}
      action={
        <Button href="/inventory/experiments/new" variant="primary" icon={<Plus />}>
          {t("newExperiment")}
        </Button>
      }
    />
  );

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description", { count: total })}
        actions={
          <Button href="/inventory/experiments/new" variant="primary" icon={<Plus />}>
            {t("newExperiment")}
          </Button>
        }
      />

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
              label={t("sortLabel")}
              value={`${sort}:${list.order}`}
              options={sortOptions}
            />
            <ViewModeToggle basePath={BASE} params={current} activeView={view} />
            <div className="flex flex-wrap items-center gap-2">
              {view === "table" ? (
                <ColumnsMenu
                  state={{ base: BASE, query }}
                  columns={optionalColumns}
                  hidden={hidden}
                />
              ) : null}
              <SavedViewsMenu
                list="experiments"
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
          chips={EXPERIMENT_LIST_STATUSES.map((key) => ({
            key,
            label: t(`statusOptions.${key}`),
            active: status === key,
            href: href({ status: status === key ? undefined : key }),
          }))}
        />
        {admin ? (
          <FilterChips
            label={t("membershipLabel")}
            chips={[
              {
                key: "mine",
                label: t("mine"),
                active: mine,
                href: href({ mine: mine ? undefined : "1" }),
              },
            ]}
          />
        ) : null}
      </FilterBar>

      {view === "table" ? (
        <DataTable
          clientPaging={false}
          caption={t("caption")}
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          sort={{ sort, order: list.order }}
          buildSortHref={(key, order) => href({ sort: key, order })}
          empty={empty}
        />
      ) : rows.length === 0 ? (
        <Panel>{empty}</Panel>
      ) : (
        <ul
          aria-label={t("caption")}
          className="-mb-4 grid list-none gap-x-4 gap-y-0 p-0 sm:grid-cols-2 xl:grid-cols-3"
        >
          {rows.map((experiment) => (
            <li key={experiment.id} className="row-span-7 mb-4 grid grid-rows-subgrid gap-y-0">
              <ExperimentCard experiment={experiment} />
            </li>
          ))}
        </ul>
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
