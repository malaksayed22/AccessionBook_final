export const dynamic = "force-dynamic";

import { Download, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { EntityLink } from "@/components/page/EntityLink";
import { FilterBar } from "@/components/page/FilterBar";
import { RegisterSearchForm } from "@/components/RegisterSearchForm";
import { UnitTypeBadge } from "@/components/page/domain-badges";
import { Button, buttonStyles } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import {
  DESTROYED_LIST_SORTS,
  listDestroyedUnits,
  listWasteEntries,
  WASTE_LIMIT,
  type WasteRow,
  type DestroyedListRow,
} from "@/features/qa/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { dayParam, orderedRange } from "@/lib/date-filter";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";
import { canReadCompliance } from "@/lib/roles";

const BASE = "/inventory/destroyed";
const TYPES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("destroyed.list");
  return { title: t("pageTitle") };
}

export default async function DestroyedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("destroyed.list");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const list = parseListParams(raw, { sort: "date", order: "desc" });
  const sort = pickParam(list.sort, DESTROYED_LIST_SORTS) ?? "date";
  const type = pickParam(raw.type, TYPES);
  const { from, to } = orderedRange(dayParam(raw.from), dayParam(raw.to));

  const [{ rows, total }, waste] = await Promise.all([
    listDestroyedUnits(user, {
      q: list.q,
      type,
      from,
      to,
      sort,
      order: list.order,
      page: list.page,
      limit: list.limit,
    }),
    listWasteEntries(user, { from, to }),
  ]);

  const current = { q: list.q, type, from, to, sort, order: list.order };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || type || from || to);
  // The CSV comes from the reports API, which compliance readers may use.
  const admin = canReadCompliance(user);
  const csvHref = buildListUrl("/api/reports/destruction-register", { format: "csv", from, to });

  const columns: Array<Column<DestroyedListRow>> = [
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
      cell: (u) =>
        u.cultivarName ? (
          <EntityLink kind="cultivar" id={u.cultivarId} className="font-normal">
            {u.cultivarName}
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
          <EntityLink kind="experiment" id={u.experiment.id} className="font-normal">
            {u.experiment.ecode}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "date",
      header: t("columns.date"),
      sortKey: "date",
      cell: (u) => (
        <>
          <time dateTime={u.destroyedAt.toISOString()}>
            {format.dateTime(u.destroyedAt, "dateTime")}
          </time>
          <span className="block text-fg-secondary">
            {t("filedAt", { date: format.dateTime(u.recordedAt, "dateTime") })}
          </span>
        </>
      ),
    },
    {
      id: "reason",
      header: t("columns.reason"),
      cell: (u) => (
        <>
          {u.reason ?? domain("empty")}
          {u.comment ? <span className="block text-fg-secondary">{u.comment}</span> : null}
        </>
      ),
    },
    {
      id: "actor",
      header: t("columns.actor"),
      cell: (u) => (
        <EntityLink kind="member" id={u.actorId} className="font-normal">
          {u.actor}
        </EntityLink>
      ),
    },
    {
      id: "location",
      header: t("columns.location"),
      cell: (u) => (
        <>
          {u.locationName ? (
            <EntityLink kind="location" id={u.locationId} className="font-normal">
              {u.locationName}
            </EntityLink>
          ) : (
            domain("empty")
          )}
          {u.lastWeightGrams !== null ? (
            <span className="block text-fg-secondary">
              {t("lastWeight", { grams: format.number(u.lastWeightGrams, "grams") })}
            </span>
          ) : null}
        </>
      ),
    },
  ];

  const wasteColumns: Array<Column<WasteRow>> = [
    {
      id: "date",
      header: t("waste.columns.date"),
      rowHeader: true,
      cell: (w) => format.dateTime(w.at, "date"),
    },
    {
      id: "unit",
      header: t("waste.columns.unit"),
      cell: (w) => (
        <EntityLink kind="unit" id={w.unitId}>
          {w.unitName}
        </EntityLink>
      ),
    },
    {
      id: "type",
      header: t("waste.columns.type"),
      cell: (w) => (w.type ? domain(`wasteType.${w.type}`) : domain("empty")),
    },
    {
      id: "amount",
      header: t("waste.columns.amount"),
      align: "end",
      cell: (w) =>
        w.grams === null
          ? domain("empty")
          : t(w.moisture === "DRY" ? "waste.dry" : "waste.wet", {
              value: format.number(w.grams, "grams"),
            }),
    },
    { id: "method", header: t("waste.columns.method"), cell: (w) => w.method ?? domain("empty") },
    {
      id: "by",
      header: t("waste.columns.by"),
      cell: (w) => (
        <EntityLink kind="member" id={w.actorId}>
          {w.actor}
        </EntityLink>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description", { count: total })}
        actions={
          admin ? (
            // A file download served by the reports API: a plain link, no language prefix.
            <a href={csvHref} className={buttonStyles({ variant: "secondary" })}>
              <Download aria-hidden="true" className="size-4" />
              {t("exportCsv")}
            </a>
          ) : null
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
      >
        <FilterChips
          label={t("typeLabel")}
          clearHref={filtered ? BASE : undefined}
          chips={TYPES.map((key) => ({
            key,
            label: domain(`unitTypePlural.${key}`),
            active: type === key,
            href: href({ type: type === key ? undefined : key }),
          }))}
        />
        {admin ? <p className="text-sm text-fg-secondary">{t("exportHint")}</p> : null}
      </FilterBar>

      <DataTable
        clientPaging={false}
        caption={t("caption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        sort={{ sort, order: list.order }}
        buildSortHref={(key, order) => href({ sort: key, order })}
        empty={
          filtered ? (
            <EmptyState
              icon={<Trash2 />}
              title={t("noMatchTitle")}
              description={t("noMatchBody")}
              action={
                <Button href={BASE} variant="secondary">
                  {t("clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<Trash2 />} title={t("emptyTitle")} description={t("emptyBody")} />
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

      <section aria-labelledby="waste-heading" className="mt-10">
        <h2 id="waste-heading" className="text-lg font-semibold text-fg">
          {t("waste.title")}
        </h2>
        <p className="mt-1 mb-3 text-sm text-fg-secondary">
          {t("waste.description")}
          {waste.total > WASTE_LIMIT
            ? ` ${t("waste.limited", { shown: WASTE_LIMIT, total: waste.total })}`
            : ""}
        </p>
        <DataTable
          caption={t("waste.title")}
          captionHidden
          columns={wasteColumns}
          rows={waste.rows}
          rowKey={(w) => w.stateId}
          empty={
            <EmptyState
              icon={<Trash2 />}
              title={t("waste.emptyTitle")}
              description={t("waste.emptyBody")}
            />
          }
        />
      </section>
    </div>
  );
}
