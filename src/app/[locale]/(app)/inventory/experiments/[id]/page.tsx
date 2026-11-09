export const dynamic = "force-dynamic";

import {
  FileDown,
  FlaskConical,
  GitBranch,
  Plus,
  Printer,
  ReceiptText,
  ScrollText,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CreateUnitsButtons } from "@/components/actions/CreateUnitsButtons";
import { ExperimentBars } from "@/components/experiment/ExperimentBars";
import { ExperimentSideTabs } from "@/components/experiment/ExperimentSideTabs";
import { ExperimentDocumentsPanel } from "@/components/experiment/ExperimentDocumentsPanel";
import { ExperimentEditPanel } from "@/components/experiment/ExperimentEditPanel";
import { ExperimentMembersPanel } from "@/components/experiment/ExperimentMembersPanel";
import { ExperimentStatusActions } from "@/components/experiment/ExperimentStatusActions";
import { ExperimentStatusBadge } from "@/components/experiment/ExperimentStatusBadge";
import { EntityLink } from "@/components/page/EntityLink";
import { richValue } from "@/components/page/rich-value";
import {
  ShipmentStatusBadge,
  UnitStatusBadge,
  UnitTypeBadge,
} from "@/components/page/domain-badges";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonStyles } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { NewTaskButton, TaskRowActions } from "@/components/task/TaskDialogs";
import { BulkBar, BulkProvider, RowSelect, SelectAll } from "@/components/unit/BulkSelection";
import { listLocationOptions } from "@/features/unit/queries";
import { getTaskFormOptions, listTasks } from "@/features/task/queries";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { CALENDAR_DAY_FORMAT, toDateInput } from "@/features/experiment/dates";
import { recordIdParam } from "@/features/experiment/ids";
import {
  EXPERIMENT_UNIT_SORTS,
  EXPERIMENT_UNIT_STATUSES,
  getExperimentCode,
  getExperimentDetail,
  listExperimentUnits,
  type ExperimentDetail,
  type ExperimentUnitRow,
} from "@/features/experiment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getSessionUser, requirePageUser, type SessionUser } from "@/lib/auth";
import { zonedDateKey } from "@/lib/lab-time";
import { env } from "@/server/env";
import { buildListUrl, parseListParams, pickParam, positiveIntParam } from "@/lib/list-params";
import {
  canManageLocations,
  destroysUnits,
  isQuality,
  isReadOnly,
  seesWholeLab,
} from "@/lib/roles";

type SearchParams = Record<string, string | undefined>;

const UNITS_ANCHOR = "units";

async function loadDetail(id: string) {
  const experimentId = recordIdParam(id);
  if (!experimentId) notFound();
  const user = await requirePageUser();
  const detail = await getExperimentDetail(user, experimentId);
  if (!detail) notFound();
  return { user, detail };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("experiments.detail");
  // The tab shows the experiment's code (EXP124), never the database number.
  const numericId = positiveIntParam(id);
  const user = await getSessionUser();
  const code = numericId && user ? await getExperimentCode(user, numericId) : null;
  return { title: code ?? t("pageTitleFallback") };
}

export default async function ExperimentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = await resolveRequestLocale(params);
  const { id } = await params;
  const { user, detail } = await loadDetail(id);
  const raw = await searchParams;
  const t = await getTranslations("experiments.detail");
  const side = await getTranslations("experiments.detail.side");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const list = parseListParams(raw, { sort: "name", order: "asc" });
  const sort = pickParam(list.sort, EXPERIMENT_UNIT_SORTS) ?? "name";
  const status = pickParam(raw.status, EXPERIMENT_UNIT_STATUSES);
  const { rows: unitRows, total: unitTotal } = await listExperimentUnits(user, detail.id, {
    status,
    sort,
    order: list.order,
    page: list.page,
    limit: list.limit,
  });

  // The bulk actions are for people who can edit the experiment's units.
  const moveTargets = detail.canEdit ? await listLocationOptions() : [];

  const base = `/inventory/experiments/${detail.id}`;
  const labToday = zonedDateKey(new Date(), env().LAB_TIMEZONE);
  const current = {
    status,
    sort,
    order: list.order,
    limit: raw.limit ? list.limit : undefined,
  };
  const unitsHref = (overrides: Record<string, string | number | undefined | null>) =>
    `${buildListUrl(base, current, { page: undefined, ...overrides })}#${UNITS_ANCHOR}`;

  const lead = detail.members.find((m) => m.role === "LEAD");
  const day = (date: Date) => format.dateTime(date, CALENDAR_DAY_FORMAT);

  const unitColumns: Array<Column<ExperimentUnitRow>> = [
    ...(detail.canEdit
      ? [
          {
            id: "select",
            header: <SelectAll />,
            cell: (u: ExperimentUnitRow) => <RowSelect id={u.id} name={u.name} />,
          },
        ]
      : []),
    {
      id: "name",
      header: t("units.columns.name"),
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
      header: t("units.columns.type"),
      sortKey: "type",
      cell: (u) => <UnitTypeBadge type={u.type} />,
    },
    {
      id: "cultivar",
      header: t("units.columns.cultivar"),
      sortKey: "cultivar",
      cell: (u) => (
        <EntityLink kind="cultivar" id={u.cultivarId}>
          {u.cultivarName ?? domain("empty")}
        </EntityLink>
      ),
    },
    {
      id: "location",
      header: t("units.columns.location"),
      sortKey: "location",
      cell: (u) => (
        <EntityLink kind="location" id={u.locationId}>
          {u.locationName ?? domain("empty")}
        </EntityLink>
      ),
    },
    {
      id: "updated",
      header: t("units.columns.updated"),
      sortKey: "date",
      cell: (u) => (
        <time dateTime={u.lastUpdated.toISOString()}>
          {format.dateTime(u.lastUpdated, "dateTime")}
        </time>
      ),
    },
    {
      id: "status",
      header: t("units.columns.status"),
      cell: (u) => <UnitStatusBadge status={u.status} nothingLeft={u.nothingLeft} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="experiments" current={detail.ecode} />}
        className="pb-0"
        title={
          <>
            <span className="font-mono text-accent-text">{detail.ecode}</span>
            {" · "}
            {detail.name}
          </>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <ExperimentStatusBadge status={detail.status} />
            <span>
              {lead
                ? t.rich("ledBy", {
                    name: richValue(
                      <EntityLink kind="member" id={lead.userId}>
                        {lead.name}
                      </EntityLink>
                    ),
                  })
                : t("noLead")}
            </span>
            <span>{t("createdOn", { date: day(detail.createdAt) })}</span>
          </span>
        }
        actions={
          <>
            {detail.canEdit ? (
              <CreateUnitsButtons
                experiment={{
                  id: detail.id,
                  ecode: detail.ecode,
                  name: detail.name,
                  canEdit: detail.canEdit,
                }}
              />
            ) : null}
            {detail.counts.inventory > 0 ? (
              <Button href={`${base}/labels`} variant="secondary" icon={<Printer />}>
                {t("printLabels")}
              </Button>
            ) : null}
            {/* A file from an API route: a plain link, with no language prefix. */}
            <a
              href={`/api/experiments/${detail.id}/record?locale=${locale}`}
              download
              className={buttonStyles({ variant: "secondary" })}
            >
              <FileDown aria-hidden="true" className="size-4" />
              {t("recordPdf")}
            </a>
            <ExperimentStatusActions
              experimentId={detail.id}
              status={detail.status}
              startDate={toDateInput(detail.startDate)}
              today={labToday}
              canComplete={detail.canEdit}
              canReopen={detail.canManageMembers}
            />
            {detail.canEdit ? (
              <Button
                href={`/inventory/experiments/new?parent=${detail.id}`}
                variant="secondary"
                icon={<Plus />}
              >
                {t("newSubExperiment")}
              </Button>
            ) : null}
          </>
        }
      />

      {raw.created === "1" ? (
        <Banner tone="success" title={t("createdBanner.title")}>
          {detail.counts.total > 0 ? (
            <span>
              {t("createdBanner.withUnits", { count: detail.counts.total })}{" "}
              <Link href={`${base}/labels`} className="font-medium underline underline-offset-2">
                {t("createdBanner.printLink")}
              </Link>
            </span>
          ) : (
            t("createdBanner.noUnits")
          )}
        </Banner>
      ) : null}

      {/* The charts below say how many units are where: no number cards above them. */}

      <Panel className="mb-6">
        <PanelBody>
          <ExperimentBars
            counts={detail.counts}
            types={detail.types}
            timeline={detail.timeline}
            className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:space-y-0 [&>div:first-child]:lg:col-span-2"
          />
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <ExperimentEditPanel
            experimentId={detail.id}
            canEdit={detail.canEdit}
            isAdmin={detail.canManageMembers}
            today={labToday}
            initial={{
              name: detail.name,
              comment: detail.comment,
              startDate: toDateInput(detail.startDate),
              endDate: detail.endDate ? toDateInput(detail.endDate) : null,
              estimatedEndDate: detail.estimatedEndDate
                ? toDateInput(detail.estimatedEndDate)
                : null,
              status: detail.status,
            }}
          />

          <GroupsSection detail={detail} />

          <section id={UNITS_ANCHOR} aria-labelledby="units-heading" className="scroll-mt-20">
            <h2 id="units-heading" className="mb-3 text-base font-semibold text-fg">
              {t("units.title")}
            </h2>
            <FilterChips
              className="mb-3"
              label={t("units.statusLabel")}
              clearHref={status ? unitsHref({ status: undefined }) : undefined}
              chips={EXPERIMENT_UNIT_STATUSES.map((key) => ({
                key,
                label: t(`units.statusOptions.${key}`),
                active: status === key,
                href: unitsHref({ status: status === key ? undefined : key }),
              }))}
            />
            <BulkProvider
              units={unitRows.map((u) => ({
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
              canDestroy={detail.canEdit && destroysUnits(user)}
              canRelease={isQuality(user)}
            >
              <DataTable
                clientPaging={false}
                caption={t("units.caption", { code: detail.ecode })}
                captionHidden
                columns={unitColumns}
                rows={unitRows}
                rowKey={(u) => u.id}
                sort={{ sort, order: list.order }}
                buildSortHref={(key, order) => unitsHref({ sort: key, order })}
                empty={
                  status ? (
                    <EmptyState
                      icon={<FlaskConical />}
                      headingLevel={3}
                      title={t("units.noMatchTitle")}
                      description={t("units.noMatchBody")}
                      action={
                        <Button href={unitsHref({ status: undefined })} variant="secondary">
                          {t("units.clearFilter")}
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<FlaskConical />}
                      headingLevel={3}
                      title={t("units.emptyTitle")}
                      description={
                        detail.canEdit ? t("units.emptyBodyEditable") : t("units.emptyBody")
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
              total={unitTotal}
              buildHref={(page) =>
                `${buildListUrl(base, { ...current, limit: list.limit }, { page })}#${UNITS_ANCHOR}`
              }
            />
          </section>
        </div>

        {/* One section at a time, as tabs, so the side column stays short. */}
        <div className="min-w-0">
          <ExperimentSideTabs
            label={side("label")}
            tabs={[
              {
                id: "tasks",
                label: side("tasks"),
                panel: <TasksSection detail={detail} user={user} />,
              },
              {
                id: "team",
                label: side("team"),
                count: detail.members.length,
                panel: (
                  <ExperimentMembersPanel
                    experimentId={detail.id}
                    members={detail.members}
                    availableUsers={detail.availableUsers}
                    canManage={detail.canManageMembers}
                  />
                ),
              },
              {
                id: "documents",
                label: side("documents"),
                count: detail.documents.length,
                panel: (
                  <ExperimentDocumentsPanel
                    experimentId={detail.id}
                    documents={detail.documents}
                    canEdit={detail.canEdit}
                  />
                ),
              },
              { id: "related", label: side("related"), panel: <RelatedSection detail={detail} /> },
              {
                id: "provenance",
                label: side("provenance"),
                panel: (
                  <div className="space-y-6">
                    <ProvenanceSection detail={detail} />
                    <ReceiptsSection detail={detail} />
                  </div>
                ),
              },
              {
                id: "activity",
                label: side("activity"),
                panel: <ActivitySection detail={detail} />,
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

// --- Sections -------------------------------------------------------------------------------------

async function GroupsSection({ detail }: { detail: ExperimentDetail }) {
  const t = await getTranslations("experiments.detail.groups");
  const domain = await getTranslations("domain");
  const columns: Array<Column<ExperimentDetail["groups"][number]>> = [
    { id: "type", header: t("columns.type"), cell: (g) => <UnitTypeBadge type={g.type} /> },
    {
      id: "cultivar",
      header: t("columns.cultivar"),
      cell: (g) => (
        <EntityLink kind="cultivar" id={g.cultivarId}>
          {g.cultivarName ?? domain("empty")}
        </EntityLink>
      ),
    },
    {
      id: "inventory",
      header: t("columns.inventory"),
      align: "end",
      cell: (g) => <span className="tabular-nums">{g.inventory}</span>,
    },
    {
      id: "total",
      header: t("columns.total"),
      align: "end",
      cell: (g) => <span className="tabular-nums">{g.total}</span>,
    },
  ];
  return (
    <section aria-labelledby="groups-heading">
      <h2 id="groups-heading" className="mb-1 text-base font-semibold text-fg">
        {t("title")}
      </h2>
      <p className="mb-3 text-sm text-fg-secondary">{t("description")}</p>
      <DataTable
        caption={t("caption")}
        captionHidden
        columns={columns}
        rows={detail.groups}
        rowKey={(g) => `${g.type}:${g.cultivarId ?? "none"}`}
        density="compact"
        empty={<span className="text-fg-secondary">{t("empty")}</span>}
      />
      {detail.locations.length > 0 ? (
        <p className="mt-3 text-sm text-fg-secondary">
          {t("locations")}{" "}
          {detail.locations.map((location, index) => (
            <span key={location.id}>
              {index > 0 ? ", " : null}
              <EntityLink kind="location" id={location.id}>
                {location.name}
              </EntityLink>{" "}
              ({location.count})
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

async function RelatedSection({ detail }: { detail: ExperimentDetail }) {
  const t = await getTranslations("experiments.detail.related");
  const empty = !detail.parent && detail.children.length === 0 && !detail.sourceUnit;
  return (
    <Panel>
      <PanelHeader title={t("title")} />
      <PanelBody className="space-y-4 text-sm">
        {empty ? <p className="text-fg-secondary">{t("none")}</p> : null}
        {detail.parent ? (
          <div>
            <h3 className="font-medium text-fg-secondary">{t("parent")}</h3>
            <p className="mt-1 flex items-start gap-1.5">
              <GitBranch aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-tertiary" />
              <Link href={`/inventory/experiments/${detail.parent.id}`} className="hover:underline">
                <span className="font-mono font-semibold text-accent-text">
                  {detail.parent.ecode}
                </span>{" "}
                {detail.parent.name}
              </Link>
            </p>
          </div>
        ) : null}
        {detail.sourceUnit ? (
          <div>
            <h3 className="font-medium text-fg-secondary">{t("sourceUnit")}</h3>
            <p className="mt-1">
              <Link
                href={`/inventory/units/${detail.sourceUnit.id}`}
                className="font-mono text-accent-text hover:underline"
              >
                {detail.sourceUnit.name}
              </Link>
            </p>
          </div>
        ) : null}
        {detail.children.length > 0 ? (
          <div>
            <h3 className="font-medium text-fg-secondary">
              {t("children", { count: detail.children.length })}
            </h3>
            <ul className="mt-1 space-y-1.5">
              {detail.children.map((child) => (
                <li key={child.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/inventory/experiments/${child.id}`} className="hover:underline">
                    <span className="font-mono font-semibold text-accent-text">{child.ecode}</span>{" "}
                    {child.name}
                  </Link>
                  <ExperimentStatusBadge status={child.status} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** The experiment's open tasks, the soonest first, and planning a new one. */
async function TasksSection({ detail, user }: { detail: ExperimentDetail; user: SessionUser }) {
  const t = await getTranslations("tasks.panel");
  const format = await getFormatter();
  const [tasks, options] = await Promise.all([
    listTasks(user, { view: "all", status: "OPEN", experimentId: detail.id, limit: 6 }),
    getTaskFormOptions(user),
  ]);
  const canPlan = !isReadOnly(user) && (detail.canEdit || seesWholeLab(user));
  const day = (key: string) => format.dateTime(new Date(`${key}T12:00:00Z`), "date");
  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("description")}
        actions={
          canPlan ? (
            <NewTaskButton
              options={options}
              today={zonedDateKey(new Date(), env().LAB_TIMEZONE)}
              experiment={{ id: detail.id, ecode: detail.ecode }}
              variant="secondary"
            />
          ) : undefined
        }
      />
      <PanelBody>
        {tasks.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-medium wrap-break-word text-fg">{task.title}</p>
                  <p className={task.overdue ? "text-danger" : "text-fg-secondary"}>
                    {t(task.overdue ? "overdue" : "due", { date: day(task.due) })}
                    {task.assignee ? ` · ${task.assignee.name}` : ""}
                  </p>
                </div>
                {task.canChange ? (
                  <TaskRowActions
                    task={{
                      id: task.id,
                      title: task.title,
                      due: task.due,
                      status: task.status,
                      assigneeId: task.assignee?.id ?? null,
                    }}
                    members={options.members}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/inventory/tasks?view=all"
          className="mt-3 inline-block text-sm text-accent-text hover:underline"
        >
          {t("all")}
        </Link>
      </PanelBody>
    </Panel>
  );
}

async function ProvenanceSection({ detail }: { detail: ExperimentDetail }) {
  const t = await getTranslations("experiments.detail.provenance");
  const domain = await getTranslations("domain");
  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody>
        {detail.provenance.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.provenance.map((row, index) => (
              <li key={index} className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
                <p className="font-medium text-fg">
                  {row.sourceType ? domain(`sourceType.${row.sourceType}`) : t("unknownType")}
                  <span className="font-normal text-fg-secondary">
                    {" · "}
                    {t("units", { count: row.units })}
                  </span>
                </p>
                <p className="text-fg-secondary">
                  {row.provider ? (
                    <>
                      {t("provider")}{" "}
                      <Link
                        href={`/records/organizations/${row.provider.id}`}
                        className="text-accent-text hover:underline"
                      >
                        {row.provider.name}
                      </Link>
                    </>
                  ) : (
                    t("internal")
                  )}
                </p>
                {row.description ? (
                  <p className="wrap-break-word text-fg">{row.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

async function ReceiptsSection({ detail }: { detail: ExperimentDetail }) {
  const t = await getTranslations("experiments.detail.receipts");
  const format = await getFormatter();
  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody>
        {detail.receipts.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.receipts.map((receipt) => (
              <li key={receipt.id} className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
                <p className="flex flex-wrap items-center gap-2">
                  <ReceiptText aria-hidden="true" className="size-4 text-fg-tertiary" />
                  <Link
                    href={`/inventory/materials/${receipt.id}`}
                    className="font-mono font-semibold text-accent-text hover:underline"
                  >
                    {receipt.reference}
                  </Link>
                  <ShipmentStatusBadge status={receipt.status} />
                </p>
                <p className="text-fg-secondary">
                  <EntityLink kind="organization" id={receipt.organization.id}>
                    {receipt.organization.name}
                  </EntityLink>
                  {receipt.deliveredDate
                    ? ` · ${t("delivered", { date: format.dateTime(receipt.deliveredDate, "date") })}`
                    : null}
                </p>
                <p className="text-fg-secondary">{t("lines", { count: receipt.lines })}</p>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

async function ActivitySection({ detail }: { detail: ExperimentDetail }) {
  const t = await getTranslations("experiments.detail.activity");
  const format = await getFormatter();
  const { activity } = detail;
  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("description")}
        actions={
          detail.canViewAudit ? (
            <Button
              href={`/inventory/experiments/${detail.id}/log`}
              variant="ghost"
              size="sm"
              icon={<ScrollText />}
            >
              {t("fullLog")}
            </Button>
          ) : undefined
        }
      />
      <PanelBody className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
          <div>
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("unitEvents")}
            </dt>
            <dd className="mt-1.5 text-lg font-semibold text-fg tabular-nums">
              {format.number(activity.unitEvents, "count")}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("fieldRecords")}
            </dt>
            <dd className="mt-1.5 text-lg font-semibold text-fg tabular-nums">
              {format.number(activity.fieldRecords, "count")}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("openIncidents")}
            </dt>
            <dd className="mt-1.5 text-lg font-semibold text-fg tabular-nums">
              <Link href="/quality?view=incidents" className="text-accent-text hover:underline">
                {format.number(activity.openIncidents, "count")}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("lastEvent")}
            </dt>
            <dd className="mt-1.5 text-fg">
              {activity.lastUnitEventAt ? (
                <time dateTime={activity.lastUnitEventAt.toISOString()}>
                  {format.dateTime(activity.lastUnitEventAt, "dateTime")}
                </time>
              ) : (
                t("noEvents")
              )}
            </dd>
          </div>
        </dl>

        {detail.canViewAudit ? (
          <div>
            <h3 className="mb-2 font-medium text-fg-secondary">{t("recent")}</h3>
            {activity.recent.length === 0 ? (
              <p className="text-fg-secondary">{t("noRecent")}</p>
            ) : (
              <ul className="space-y-3">
                {activity.recent.map((entry) => (
                  <li key={entry.id}>
                    <p className="wrap-break-word text-fg">{entry.summary}</p>
                    <p className="text-fg-secondary">
                      <EntityLink kind="member" id={entry.userId}>
                        {entry.userName}
                      </EntityLink>{" "}
                      ·{" "}
                      <time dateTime={entry.at.toISOString()}>
                        {format.dateTime(entry.at, "dateTime")}
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
