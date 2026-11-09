export const dynamic = "force-dynamic";

import { Lock, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuditActionBadge, AuditEntityType } from "@/components/AuditLabels";
import { EntityLink } from "@/components/page/EntityLink";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { LiveForm } from "@/components/page/LiveForm";
import { SearchField } from "@/components/page/SearchField";
import { Field } from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/FormControls";
import { LockedState } from "@/components/ui/LockedState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { auditEntityHref, isKnownAction, isKnownEntityType } from "@/features/audit/links";
import {
  getAuditFilterOptions,
  listAuditEntries,
  type AuditEntryRow,
} from "@/features/audit/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam, positiveIntParam } from "@/lib/list-params";
import { isDateKey } from "@/lib/reports/filters";
import { canReadCompliance } from "@/lib/roles";

const BASE = "/compliance/audit";

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activity");
  return { title: t("pageTitle") };
}

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("activity");
  const domain = await getTranslations("domain");

  if (!canReadCompliance(user)) {
    return (
      <div>
        <PageHeader title={t("title")} />
        <LockedState
          icon={<Lock />}
          title={t("locked.title")}
          body={t("locked.body")}
          action={{ label: t("locked.action"), href: "/dashboard" }}
        />
      </div>
    );
  }

  const raw = await searchParams;
  const format = await getFormatter();
  const options = await getAuditFilterOptions(user);

  const list = parseListParams(raw, { sort: "date", order: "desc" });
  const actorId = pickParam(
    raw.actor,
    options.actors.map((actor) => String(actor.id))
  );
  const entityType = pickParam(raw.entity, options.entityTypes);
  const action = pickParam(raw.action, options.actions);
  const from = raw.from && isDateKey(raw.from) ? raw.from : undefined;
  const to = raw.to && isDateKey(raw.to) ? raw.to : undefined;
  const invalidDates = Boolean((raw.from && !from) || (raw.to && !to));
  const [{ rows, total }] = await Promise.all([
    listAuditEntries(user, {
      q: list.q,
      actorId: positiveIntParam(actorId),
      entityType,
      action,
      from,
      to,
      order: list.order,
      page: list.page,
      limit: list.limit,
    }),
  ]);

  const current = {
    q: list.q,
    actor: actorId,
    entity: entityType,
    action,
    from,
    to,
    order: list.order === "asc" ? "asc" : undefined,
    limit: raw.limit ? list.limit : undefined,
  };
  const filtered = Boolean(list.q || actorId || entityType || action || from || to);
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });

  const columns: Array<Column<AuditEntryRow>> = [
    {
      id: "seq",
      header: t("list.columns.seq"),
      className: "tabular-nums",
      cell: (entry) => `#${entry.seq}`,
    },
    {
      id: "when",
      header: t("list.columns.when"),
      sortKey: "date",
      cell: (entry) => (
        <time dateTime={entry.createdAt.toISOString()}>
          {format.dateTime(entry.createdAt, "dateTime")}
        </time>
      ),
    },
    {
      id: "actor",
      header: t("list.columns.actor"),
      cell: (entry) => (
        <>
          {entry.attempt ? (
            t("anonymousAttempt")
          ) : (
            <EntityLink kind="member" id={entry.actorId}>
              {entry.actorName}
            </EntityLink>
          )}
          <span className="block text-fg-secondary">
            {entry.attempt
              ? t("list.attemptOn", { name: entry.actorName })
              : entry.actorId === null
                ? t("list.noActor")
                : entry.actorRole === "ADMIN" || entry.actorRole === "REGULAR"
                  ? domain(`role.${entry.actorRole}`)
                  : entry.actorRole}
          </span>
        </>
      ),
    },
    {
      id: "action",
      header: t("list.columns.action"),
      cell: (entry) => <AuditActionBadge action={entry.action} />,
    },
    {
      id: "record",
      header: t("list.columns.record"),
      cell: (entry) => {
        const link = auditEntityHref(entry.entityType, entry.entityId);
        return (
          <>
            <span className="block text-fg-secondary">
              <AuditEntityType type={entry.entityType} />
            </span>
            {link ? (
              <Link
                href={link}
                className="inline-block min-h-6 font-medium leading-6 text-accent-text hover:underline"
              >
                {entry.entityLabel}
              </Link>
            ) : (
              <span className="font-medium">{entry.entityLabel}</span>
            )}
          </>
        );
      },
    },
    {
      id: "changes",
      header: t("list.columns.changes"),
      className: "min-w-64",
      cell: (entry) => (
        <>
          <p>{entry.summary}</p>
          {entry.changes.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-fg-secondary">
              {entry.changes.map((change, index) => (
                <li key={`${change.field}-${index}`}>
                  {t("list.changeLine", {
                    field: change.field,
                    from: change.from ?? "—",
                    to: change.to ?? "—",
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {entry.reason ? (
            <p className="mt-1 text-fg-secondary">{t("list.reason", { reason: entry.reason })}</p>
          ) : null}
        </>
      ),
    },
    {
      id: "request",
      header: t("list.columns.request"),
      cell: (entry) =>
        entry.requestId ? <code className="break-all text-xs">{entry.requestId}</code> : "—",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} className="pb-0" />

      <div className="mb-6 border-b border-border pb-5 print:hidden">
        <LiveForm action={BASE} aria-label={t("filters.label")} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-3">
              <label htmlFor="audit-q" className="sr-only">
                {t("filters.search")}
              </label>
              <SearchField
                id="audit-q"
                name="q"
                defaultValue={list.q}
                placeholder={t("filters.searchPlaceholder")}
                maxLength={100}
              />
            </div>
            <Field label={t("filters.actor")}>
              {(control) => (
                <Select variant="line" name="actor" defaultValue={actorId ?? ""} {...control}>
                  <option value="">{t("filters.allActors")}</option>
                  {options.actors.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("filters.entity")}>
              {(control) => (
                <Select variant="line" name="entity" defaultValue={entityType ?? ""} {...control}>
                  <option value="">{t("filters.allEntities")}</option>
                  {options.entityTypes.map((type) => (
                    <option key={type} value={type}>
                      {isKnownEntityType(type) ? t(`entityTypes.${type}`) : type}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("filters.action")}>
              {(control) => (
                <Select variant="line" name="action" defaultValue={action ?? ""} {...control}>
                  <option value="">{t("filters.allActions")}</option>
                  {options.actions.map((value) => (
                    <option key={value} value={value}>
                      {isKnownAction(value) ? t(`actions.${value}`) : value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("filters.from")}>
              {(control) => (
                <Input variant="line" name="from" type="date" defaultValue={from} {...control} />
              )}
            </Field>
            <Field label={t("filters.to")}>
              {(control) => (
                <Input variant="line" name="to" type="date" defaultValue={to} {...control} />
              )}
            </Field>
          </div>
          {raw.order === "asc" ? <input type="hidden" name="order" value="asc" /> : null}
          {raw.limit ? <input type="hidden" name="limit" value={list.limit} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            {filtered ? (
              <Button href={BASE} variant="ghost">
                {t("filters.clear")}
              </Button>
            ) : null}
            <p className="text-sm text-fg-secondary">{t("filters.zoneNote")}</p>
          </div>
          {invalidDates ? (
            <p role="status" className="text-sm text-warning">
              {t("filters.invalidDates")}
            </p>
          ) : null}
        </LiveForm>
      </div>

      <p className="text-sm text-fg-secondary" aria-live="polite">
        {t("list.count", { count: total })}
      </p>

      <DataTable
        clientPaging={false}
        caption={t("list.caption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(entry) => entry.id}
        sort={{ sort: "date", order: list.order }}
        buildSortHref={(_key, order) => href({ order: order === "asc" ? "asc" : undefined })}
        empty={
          filtered ? (
            <EmptyState
              icon={<ScrollText />}
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
              icon={<ScrollText />}
              title={t("list.emptyTitle")}
              description={t("list.emptyBody")}
            />
          )
        }
      />
      <Pagination
        page={list.page}
        pageSize={list.limit}
        total={total}
        buildHref={(page) => buildListUrl(BASE, current, { page })}
      />
    </div>
  );
}
