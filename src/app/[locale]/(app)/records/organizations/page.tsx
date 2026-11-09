export const dynamic = "force-dynamic";

import { Building2, Plus } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { OrganizationRelations } from "@/components/OrganizationRelations";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { SelectFilter } from "@/components/page/SelectFilter";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import {
  listOrganizationCountries,
  listOrganizations,
  ORGANIZATION_LIST_SORTS,
  ORGANIZATION_RELATIONS,
  type OrganizationListRow,
} from "@/features/organization/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";

const BASE = "/records/organizations";

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("organizations.list");
  return { title: t("pageTitle") };
}

export default async function OrganizationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("organizations");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const canManage = isAdmin(user);

  const list = parseListParams(raw, { sort: "name", order: "asc" });
  const sort = pickParam(list.sort, ORGANIZATION_LIST_SORTS) ?? "name";
  const relation = pickParam(raw.relation, ORGANIZATION_RELATIONS);

  const countries = await listOrganizationCountries();
  // The country comes from the URL: only a country that exists is used.
  const country = countries.find((c) => c === raw.country);

  const { rows, total } = await listOrganizations(user, {
    q: list.q,
    relation,
    country,
    sort,
    order: list.order,
    page: list.page,
    limit: list.limit,
  });

  const current = { q: list.q, relation, country, sort, order: list.order };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || relation || country);

  const columns: Array<Column<OrganizationListRow>> = [
    {
      id: "code",
      header: t("list.columns.code"),
      cell: (o) => (
        <Link
          href={`${BASE}/${o.id}`}
          className="font-mono text-sm text-accent-text tabular-nums hover:underline"
        >
          {o.code}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("list.columns.name"),
      sortKey: "name",
      rowHeader: true,
      cell: (o) => (
        <Link href={`${BASE}/${o.id}`} className="font-medium text-accent-text hover:underline">
          {o.name}
        </Link>
      ),
    },
    {
      id: "relation",
      header: t("list.columns.relation"),
      cell: (o) => <OrganizationRelations relations={o.relations} />,
    },
    {
      id: "country",
      header: t("list.columns.country"),
      sortKey: "country",
      cell: (o) =>
        o.country ? (
          <Link
            href={buildListUrl(BASE, { country: o.country })}
            className="text-accent-text hover:underline"
          >
            {o.country}
          </Link>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "licence",
      header: t("list.columns.licence"),
      cell: (o) =>
        o.licenceNumber ? (
          <span className="font-mono text-xs">{o.licenceNumber}</span>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "units",
      header: t("list.columns.units"),
      sortKey: "units",
      align: "end",
      cell: (o) => (
        <Link
          href={`${BASE}/${o.id}#org-units`}
          className="text-accent-text tabular-nums hover:underline"
        >
          {format.number(o.suppliedUnits, "count")}
        </Link>
      ),
    },
    {
      id: "inbound",
      header: t("list.columns.inbound"),
      sortKey: "shipments",
      align: "end",
      cell: (o) => (
        <Link
          href={buildListUrl("/inventory/materials", { organization: o.id, direction: "INBOUND" })}
          className="text-accent-text tabular-nums hover:underline"
        >
          {format.number(o.inboundShipments, "count")}
        </Link>
      ),
    },
    {
      id: "outbound",
      header: t("list.columns.outbound"),
      align: "end",
      cell: (o) => (
        <Link
          href={buildListUrl("/inventory/materials", { organization: o.id, direction: "OUTBOUND" })}
          className="text-accent-text tabular-nums hover:underline"
        >
          {format.number(o.outboundShipments, "count")}
        </Link>
      ),
    },
    {
      id: "labResults",
      header: t("list.columns.labResults"),
      align: "end",
      cell: (o) => (
        <Link
          href={`${BASE}/${o.id}#org-tests`}
          className="text-accent-text tabular-nums hover:underline"
        >
          {format.number(o.labResults, "count")}
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("list.title")}
        description={t("list.description", { count: total })}
        actions={
          canManage ? (
            <Button href="/records/organizations/new" variant="primary" icon={<Plus />}>
              {t("list.register")}
            </Button>
          ) : undefined
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
          <SelectFilter
            label={t("list.countryLabel")}
            value={country ?? "all"}
            options={[
              { value: "all", label: t("list.allCountries"), href: href({ country: undefined }) },
              ...countries.map((c) => ({ value: c, label: c, href: href({ country: c }) })),
            ]}
          />
        }
      >
        <FilterChips
          label={t("list.relationLabel")}
          clearHref={filtered ? BASE : undefined}
          chips={ORGANIZATION_RELATIONS.map((key) => ({
            key,
            label: t(`relation.${key}Plural`),
            active: relation === key,
            href: href({ relation: relation === key ? undefined : key }),
          }))}
        />
      </FilterBar>

      <DataTable
        caption={t("list.caption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        sort={{ sort, order: list.order }}
        buildSortHref={(key, order) => href({ sort: key, order })}
        empty={
          filtered ? (
            <EmptyState
              icon={<Building2 />}
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
              icon={<Building2 />}
              title={t("list.emptyTitle")}
              description={canManage ? t("list.emptyBody") : t("list.emptyBodyMember")}
              action={
                canManage ? (
                  <Button href="/records/organizations/new" variant="primary" icon={<Plus />}>
                    {t("list.register")}
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
