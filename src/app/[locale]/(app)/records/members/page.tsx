export const dynamic = "force-dynamic";

import { Users } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { EntityLink } from "@/components/page/EntityLink";
import { InviteMemberButton } from "@/components/InviteMemberButton";
import { MemberRowActions } from "@/components/MemberRowActions";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { MemberStatusBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import {
  listMembers,
  MEMBER_LIST_ACCESS,
  MEMBER_LIST_SORTS,
  MEMBER_LIST_STATUSES,
  type MemberListRow,
} from "@/features/member/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { pseudonymNumber } from "@/lib/invites";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";

const BASE = "/records/members";

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.list");
  return { title: t("pageTitle") };
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const viewer = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("members");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const canManage = isAdmin(viewer);

  const list = parseListParams(raw, { sort: "name", order: "asc" });
  const sort = pickParam(list.sort, MEMBER_LIST_SORTS) ?? "name";
  // Members only ever see the active members; the query enforces it, the page just hides the chips.
  const status = canManage ? pickParam(raw.status, MEMBER_LIST_STATUSES) : undefined;
  const access = pickParam(raw.access, MEMBER_LIST_ACCESS);

  const { rows, total } = await listMembers(viewer, {
    q: list.q,
    status,
    access,
    sort,
    order: list.order,
    page: list.page,
    limit: list.limit,
  });

  const current = { q: list.q, status, access, sort, order: list.order };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const filtered = Boolean(list.q || status || access);

  const displayName = (name: string) => {
    const number = pseudonymNumber(name);
    return number ? t("list.pseudonym", { number }) : name;
  };

  const columns: Array<Column<MemberListRow>> = [
    {
      id: "code",
      header: t("list.columns.code"),
      cell: (m) => (
        <Link
          href={`${BASE}/${m.id}`}
          className="font-mono text-sm text-accent-text tabular-nums hover:underline"
        >
          {m.code}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("list.columns.name"),
      sortKey: "name",
      rowHeader: true,
      cell: (m) => (
        <div className="min-w-0">
          <Link href={`${BASE}/${m.id}`} className="font-medium text-accent-text hover:underline">
            {displayName(m.name)}
          </Link>
          {m.email ? (
            <p className="mt-0.5 text-sm font-normal text-fg-secondary">{m.email}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "access",
      header: t("list.columns.access"),
      sortKey: "access",
      cell: (m) => (
        <Badge
          tone={m.access === "ADMIN" ? "accent" : "neutral"}
          href={buildListUrl(BASE, { access: m.access })}
        >
          {domain(`role.${m.access}`)}
        </Badge>
      ),
    },
    {
      id: "status",
      header: t("list.columns.status"),
      cell: (m) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MemberStatusBadge status={m.status} />
          {m.inviteExpired ? <Badge tone="warning">{t("list.inviteExpired")}</Badge> : null}
        </div>
      ),
    },
    {
      id: "experiments",
      header: t("list.columns.experiments"),
      sortKey: "experiments",
      cell: (m) =>
        m.experimentCount === 0 ? (
          domain("empty")
        ) : (
          <span>
            {m.experimentRefs.map((experiment, index) => (
              <span key={experiment.id}>
                {index > 0 ? ", " : null}
                <EntityLink kind="experiment" id={experiment.id} className="font-mono">
                  {experiment.ecode}
                </EntityLink>
              </span>
            ))}
            {m.experimentCount > m.experimentRefs.length ? (
              <>
                {" "}
                <Link href={`${BASE}/${m.id}`} className="text-accent-text hover:underline">
                  {t("list.more", {
                    count: format.number(m.experimentCount - m.experimentRefs.length, "count"),
                  })}
                </Link>
              </>
            ) : null}
          </span>
        ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: t("list.columns.actions"),
            hideHeader: true,
            align: "end" as const,
            cell: (m: MemberListRow) => (
              <MemberRowActions
                member={{
                  id: m.id,
                  name: m.name,
                  displayName: displayName(m.name),
                  email: m.email,
                  status: m.status,
                  erased: pseudonymNumber(m.name) !== null,
                  role: m.access,
                }}
                isSelf={m.id === viewer.id}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={t("list.title")}
        description={t("list.description", { count: total })}
        actions={canManage ? <InviteMemberButton /> : undefined}
      />

      <FilterBar
        search={
          <SearchForm
            action={BASE}
            params={current}
            q={list.q}
            label={t("list.searchLabel")}
            placeholder={canManage ? t("list.searchPlaceholderAdmin") : t("list.searchPlaceholder")}
          />
        }
      >
        <>
          {canManage ? (
            <FilterChips
              label={t("list.statusLabel")}
              clearHref={filtered ? BASE : undefined}
              chips={MEMBER_LIST_STATUSES.map((key) => ({
                key,
                label: domain(`memberStatus.${key}`),
                active: status === key,
                href: href({ status: status === key ? undefined : key }),
              }))}
            />
          ) : null}
          <FilterChips
            label={t("list.accessLabel")}
            clearHref={!canManage && filtered ? BASE : undefined}
            chips={MEMBER_LIST_ACCESS.map((key) => ({
              key,
              label: domain(`role.${key}`),
              active: access === key,
              href: href({ access: access === key ? undefined : key }),
            }))}
          />
        </>
      </FilterBar>

      <DataTable
        caption={t("list.caption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        sort={{ sort, order: list.order }}
        buildSortHref={(key, order) => href({ sort: key, order })}
        empty={
          filtered ? (
            <EmptyState
              icon={<Users />}
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
              icon={<Users />}
              title={t("list.emptyTitle")}
              description={t("list.emptyBody")}
              action={canManage ? <InviteMemberButton /> : undefined}
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
