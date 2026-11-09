export const dynamic = "force-dynamic";

import { Dna } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { CultivarCard } from "@/components/CultivarCard";
import { CultivarFormButton } from "@/components/CultivarFormDialog";
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
  CULTIVAR_LIST_SORTS,
  CULTIVAR_LIST_USAGE,
  listCultivars,
  type CultivarListRow,
  type CultivarListSort,
} from "@/features/cultivar/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";

const BASE = "/records/cultivars";
const VIEWS = ["cards", "table"] as const;

/** The sort choices offered in both views, as "sort:order" so one select covers both. */
const SORT_CHOICES: Array<{ sort: CultivarListSort; order: "asc" | "desc" }> = [
  { sort: "name", order: "asc" },
  { sort: "name", order: "desc" },
  { sort: "units", order: "desc" },
  { sort: "units", order: "asc" },
  { sort: "thc", order: "desc" },
  { sort: "updated", order: "desc" },
];

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cultivars.list");
  return { title: t("pageTitle") };
}

export default async function CultivarsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("cultivars");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const canManage = isAdmin(user);

  const list = parseListParams(raw, { sort: "name", order: "asc" });
  const sort = pickParam(list.sort, CULTIVAR_LIST_SORTS) ?? "name";
  const usage = pickParam(raw.usage, CULTIVAR_LIST_USAGE);
  const view = pickParam(raw.view, VIEWS) ?? "cards";

  const { rows, total } = await listCultivars(user, {
    q: list.q,
    usage,
    sort,
    order: list.order,
    page: list.page,
    limit: list.limit,
  });

  const current = {
    q: list.q,
    usage,
    sort,
    order: list.order,
    view: view === "cards" ? undefined : view,
  };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || usage);
  const potency = (value: number | null) =>
    value === null ? domain("empty") : format.number(value / 100, "percent");

  const columns: Array<Column<CultivarListRow>> = [
    {
      id: "name",
      header: t("list.columns.name"),
      sortKey: "name",
      rowHeader: true,
      cell: (c) => (
        <Link href={`${BASE}/${c.id}`} className="font-medium text-accent-text hover:underline">
          {c.name}
        </Link>
      ),
    },
    {
      id: "code",
      header: t("list.columns.code"),
      cell: (c) =>
        c.code ? (
          <Link href={`${BASE}/${c.id}`} className="font-mono text-accent-text hover:underline">
            {c.code}
          </Link>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "category",
      header: t("list.columns.category"),
      cell: (c) =>
        c.category ? (
          <Badge tone="neutral" href={buildListUrl(BASE, { q: c.category })}>
            {c.category}
          </Badge>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "thc",
      header: t("list.columns.thc"),
      sortKey: "thc",
      align: "end",
      cell: (c) => <span className="tabular-nums">{potency(c.targetThc)}</span>,
    },
    {
      id: "cbd",
      header: t("list.columns.cbd"),
      align: "end",
      cell: (c) => <span className="tabular-nums">{potency(c.targetCbd)}</span>,
    },
    {
      id: "units",
      header: t("list.columns.units"),
      sortKey: "units",
      align: "end",
      cell: (c) => (
        <Link href={`${BASE}/${c.id}`} className="text-accent-text tabular-nums hover:underline">
          {t("card.inventoryOf", { active: c.stats.activeUnits, total: c.stats.totalUnits })}
        </Link>
      ),
    },
    {
      id: "experiments",
      header: t("list.columns.experiments"),
      align: "end",
      cell: (c) => (
        <Link href={`${BASE}/${c.id}`} className="text-accent-text tabular-nums hover:underline">
          {format.number(c.stats.experiments, "count")}
        </Link>
      ),
    },
    {
      id: "hold",
      header: t("list.columns.hold"),
      cell: (c) =>
        c.stats.onHold > 0 ? (
          <Badge tone="warning" href="/quality?view=holds">
            {t("card.onHold", { count: c.stats.onHold })}
          </Badge>
        ) : (
          domain("empty")
        ),
    },
  ];

  const empty = filtered ? (
    <EmptyState
      icon={<Dna />}
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
      icon={<Dna />}
      title={t("list.emptyTitle")}
      description={canManage ? t("list.emptyBody") : t("list.emptyBodyMember")}
      action={canManage ? <CultivarFormButton /> : undefined}
    />
  );

  return (
    <div>
      <PageHeader
        title={t("list.title")}
        description={t("list.description", { count: total })}
        actions={canManage ? <CultivarFormButton /> : undefined}
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
        <>
          <FilterChips
            label={t("list.usageLabel")}
            clearHref={filtered ? BASE : undefined}
            chips={CULTIVAR_LIST_USAGE.map((key) => ({
              key,
              label: t(`list.usageOptions.${key}`),
              active: usage === key,
              href: href({ usage: usage === key ? undefined : key }),
            }))}
          />
        </>
      </FilterBar>

      {view === "table" ? (
        <DataTable
          clientPaging={false}
          caption={t("list.caption")}
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          sort={{ sort, order: list.order }}
          buildSortHref={(key, order) => href({ sort: key, order })}
          empty={empty}
        />
      ) : rows.length === 0 ? (
        <Panel>{empty}</Panel>
      ) : (
        <section aria-labelledby="cultivar-cards">
          <h2 id="cultivar-cards" className="sr-only">
            {t("list.caption")}
          </h2>
          <ul className="-mb-4 grid gap-x-4 gap-y-0 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => (
              <li key={c.id} className="row-span-7 mb-4 grid grid-rows-subgrid gap-y-0">
                <CultivarCard cultivar={c} />
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
