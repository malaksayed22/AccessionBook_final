export const dynamic = "force-dynamic";

import { FlaskConical, ShieldAlert, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { OpenIncidentButton, PlaceHoldButton, UpdateIncidentButton } from "@/components/QaDialogs";
import { ConfirmAction } from "@/components/ConfirmAction";
import { EntityLink } from "@/components/page/EntityLink";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { SeverityBadge, UnitTypeBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import {
  getQaOverview,
  QA_SEVERITIES,
  QA_SORTS,
  QA_VIEWS,
  type QaHoldRow,
  type QaIncidentRow,
  type QaTestRow,
  type QaView,
} from "@/features/qa/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams, pickParam } from "@/lib/list-params";
import { isQuality } from "@/lib/roles";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";

const BASE = "/quality";
type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qa.page");
  return { title: t("pageTitle") };
}

export default async function QualityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("qa.page");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const picked: QaView = pickParam(raw.view, QA_VIEWS) ?? "overview";
  const view: QaView = picked === "tests" && !LAB_RESULTS_SHOWN ? "overview" : picked;
  const list = parseListParams(raw, { sort: "" });
  const single = view !== "overview";
  const sort = single ? (pickParam(list.sort, QA_SORTS[view]) ?? QA_SORTS[view][0]) : undefined;
  const severity = pickParam(raw.severity, QA_SEVERITIES);

  const data = await getQaOverview(user, {
    view,
    q: list.q,
    sort,
    order: list.order,
    page: list.page,
    limit: list.limit,
    severity,
  });

  const current = {
    view: single ? view : undefined,
    q: list.q,
    sort,
    order: sort ? list.order : undefined,
    severity: view === "incidents" ? severity : undefined,
  };
  const href = (overrides: Record<string, string | number | undefined | null>) =>
    buildListUrl(BASE, current, { page: undefined, ...overrides });
  const viewHref = (target: QaView, extra: Record<string, string | undefined> = {}) =>
    buildListUrl(BASE, { view: target === "overview" ? undefined : target, q: list.q, ...extra });
  // Releasing a hold is a quality decision: admins and quality assurance.
  const admin = isQuality(user);
  const searched = Boolean(list.q);
  const sortProps = single
    ? {
        sort: { sort, order: list.order },
        buildSortHref: (key: string, order: "asc" | "desc") => href({ sort: key, order }),
      }
    : {};

  const when = (date: Date) => (
    <time dateTime={date.toISOString()}>{format.dateTime(date, "dateTime")}</time>
  );
  const unitLink = (unit: { id: number; name: string }) => (
    <Link
      href={`/inventory/units/${unit.id}`}
      className="font-medium text-accent-text hover:underline"
    >
      {unit.name}
    </Link>
  );

  const holdColumns: Array<Column<QaHoldRow>> = [
    {
      id: "unit",
      header: t("holds.columns.unit"),
      sortKey: "unit",
      rowHeader: true,
      cell: (h) => (
        <span className="flex flex-wrap items-center gap-2">
          {unitLink(h.unit)}
          <UnitTypeBadge type={h.unit.type} />
        </span>
      ),
    },
    {
      id: "reason",
      header: t("holds.columns.reason"),
      cell: (h) => (
        <>
          {h.reason}
          <span className="block text-fg-secondary">{domain(`holdOrigin.${h.origin}`)}</span>
        </>
      ),
    },
    {
      id: "location",
      header: t("holds.columns.location"),
      cell: (h) =>
        h.locationName ? (
          <EntityLink kind="location" id={h.locationId} className="font-normal">
            {h.locationName}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "placed",
      header: t("holds.columns.placed"),
      cell: (h) => (
        <>
          {when(h.placedAt)}
          <EntityLink kind="member" id={h.placedById} className="block font-normal">
            {h.placedBy}
          </EntityLink>
        </>
      ),
    },
    {
      id: "age",
      header: t("holds.columns.age"),
      sortKey: "age",
      cell: (h) =>
        h.ageDays === 0 ? t("holds.ageToday") : t("holds.ageDays", { days: h.ageDays }),
    },
    ...(admin
      ? [
          {
            id: "actions",
            header: t("columns.actions"),
            hideHeader: true,
            cell: (h: QaHoldRow) => (
              <ConfirmAction
                label={t("holds.release")}
                ariaLabel={t("holds.releaseFor", { name: h.unit.name })}
                url={`/api/units/${h.unit.id}/hold`}
                body={{ action: "release" }}
                reasonField="reason"
                requireReason
                reasonMinLength={10}
                reasonLabel={t("holds.releaseReason")}
                title={t("holds.releaseTitle", { name: h.unit.name })}
                description={t("holds.releaseBody")}
                confirmLabel={t("holds.release")}
                tone="primary"
                doneMessage={t("holds.released", { name: h.unit.name })}
              />
            ),
          } satisfies Column<QaHoldRow>,
        ]
      : []),
  ];

  const testColumns: Array<Column<QaTestRow>> = [
    {
      id: "unit",
      header: t("tests.columns.unit"),
      sortKey: "unit",
      rowHeader: true,
      cell: (r) => unitLink(r.unit),
    },
    {
      id: "panel",
      header: t("tests.columns.panel"),
      sortKey: "panel",
      cell: (r) => (
        <Link href={`/inventory/units/${r.unit.id}`} className="hover:underline">
          {domain(`testPanel.${r.panel}`)}
          {r.analyte ? <span className="block text-fg-secondary">{r.analyte}</span> : null}
          {r.wetWeight !== null || r.dryWeight !== null ? (
            <span className="block text-fg-secondary tabular-nums">
              {[
                r.wetWeight !== null
                  ? t("tests.wet", { value: format.number(r.wetWeight, "grams") })
                  : null,
                r.dryWeight !== null
                  ? t("tests.dry", { value: format.number(r.dryWeight, "grams") })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </Link>
      ),
    },
    {
      id: "result",
      header: t("tests.columns.result"),
      cell: (r) => (
        <>
          {r.value === null
            ? domain("empty")
            : `${format.number(r.value)}${r.uom ? ` ${r.uom}` : ""}`}
        </>
      ),
    },
    {
      id: "lab",
      header: t("tests.columns.lab"),
      cell: (r) => r.labName ?? domain("empty"),
    },
    {
      id: "date",
      header: t("tests.columns.date"),
      sortKey: "date",
      cell: (r) => (
        <>
          {when(r.testedAt)}
          <EntityLink kind="member" id={r.recordedBy.id} className="block font-normal">
            {r.recordedBy.name}
          </EntityLink>
        </>
      ),
    },
  ];

  const incidentColumns: Array<Column<QaIncidentRow>> = [
    {
      id: "code",
      header: t("incidents.columns.code"),
      cell: (i) => (
        <Link
          href={`/quality/incidents/${i.id}`}
          className="font-mono text-sm text-accent-text tabular-nums hover:underline"
        >
          {i.code}
        </Link>
      ),
    },
    {
      id: "title",
      header: t("incidents.columns.title"),
      sortKey: "title",
      rowHeader: true,
      cell: (i) => (
        <>
          <Link href={`/quality/incidents/${i.id}`} className="text-accent-text hover:underline">
            {i.title}
          </Link>
          <span className="line-clamp-2 block font-normal text-fg-secondary">{i.description}</span>
        </>
      ),
    },
    {
      id: "severity",
      header: t("incidents.columns.severity"),
      sortKey: "severity",
      cell: (i) => <SeverityBadge severity={i.severity} />,
    },
    {
      id: "status",
      header: t("incidents.columns.status"),
      sortKey: "status",
      cell: (i) => (
        <Badge tone={i.status === "INVESTIGATING" ? "info" : "neutral"}>
          {domain(`incidentStatus.${i.status}`)}
        </Badge>
      ),
    },
    {
      id: "unit",
      header: t("incidents.columns.unit"),
      cell: (i) =>
        i.unit ? (
          unitLink(i.unit)
        ) : i.cultivar ? (
          <EntityLink kind="cultivar" id={i.cultivar.id}>
            {i.cultivar.name}
          </EntityLink>
        ) : i.experiment ? (
          <EntityLink kind="experiment" id={i.experiment.id}>
            {i.experiment.ecode}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "opened",
      header: t("incidents.columns.opened"),
      sortKey: "date",
      cell: (i) => (
        <>
          {when(i.createdAt)}
          <EntityLink kind="member" id={i.openedById} className="block font-normal">
            {i.openedBy}
          </EntityLink>
        </>
      ),
    },
    {
      id: "actions",
      header: t("columns.actions"),
      hideHeader: true,
      cell: (i) => (
        <span className="flex flex-wrap gap-2">
          <UpdateIncidentButton
            id={i.id}
            title={i.title}
            status={i.status}
            resolution={i.resolution}
          />
        </span>
      ),
    },
  ];

  const emptyFor = (kind: "holds" | "tests" | "incidents", icon: React.ReactNode) =>
    searched ? (
      <EmptyState
        icon={icon}
        title={t("noMatchTitle")}
        description={t("noMatchBody")}
        action={
          <Button
            href={buildListUrl(BASE, { view: single ? view : undefined })}
            variant="secondary"
          >
            {t("clearSearch")}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={icon}
        title={t(`${kind}.emptyTitle`)}
        description={t(`${kind}.emptyBody`)}
      />
    );

  const sectionHeading = (
    id: string,
    title: string,
    total: number,
    target: QaView,
    shown: number
  ) => (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold text-fg">
        {title}{" "}
        {single ? (
          <span className="font-normal text-fg-secondary">({format.number(total, "count")})</span>
        ) : (
          <Link
            href={viewHref(target)}
            className="font-normal text-fg-secondary hover:text-accent-text hover:underline"
          >
            ({format.number(total, "count")})
          </Link>
        )}
      </h2>
      {!single && total > shown ? (
        <Link
          href={viewHref(target)}
          className="text-sm font-medium text-accent-text hover:underline"
        >
          {t("viewAll", { count: total })}
        </Link>
      ) : null}
    </div>
  );

  const show = (target: "holds" | "tests" | "incidents") => view === "overview" || view === target;
  const pager = (target: "holds" | "tests" | "incidents") =>
    view === target ? (
      <Pagination
        className="mt-4"
        page={list.page}
        pageSize={list.limit}
        total={data[target].total}
        buildHref={(page) => buildListUrl(BASE, { ...current, limit: list.limit }, { page })}
      />
    ) : null;

  const { counts } = data;
  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <PlaceHoldButton />
            <OpenIncidentButton />
          </>
        }
      />

      <StatusDonut
        title={t("stats.chartTitle")}
        slices={(
          [
            ["CRITICAL", counts.criticalIncidents, STATUS.bad],
            ["MAJOR", counts.majorIncidents, STATUS.caution],
            ["MINOR", counts.minorIncidents, STATUS.neutral],
          ] as const
        ).map(([key, value, gradient]) => ({
          key,
          label: domain(`incidentSeverity.${key}`),
          value,
          gradient,
          href: viewHref("incidents", { severity: key }),
        }))}
        centerValue={format.number(counts.openIncidents, "count")}
        centerLabel={t("stats.chartCenter")}
        empty={<p className="text-sm text-fg-secondary">{t("stats.noIncidents")}</p>}
        footer={
          <Link href={viewHref("holds")} className="hover:text-accent-text hover:underline">
            {t("stats.holdsLine", { count: counts.holds })}
          </Link>
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
      >
        <FilterChips
          label={t("viewLabel")}
          chips={QA_VIEWS.filter((key) => key !== "tests" || LAB_RESULTS_SHOWN).map((key) => ({
            key,
            label: t(`views.${key}`),
            active: view === key,
            href: viewHref(key),
          }))}
        />
        {view === "incidents" ? (
          <FilterChips
            label={t("incidents.severityLabel")}
            clearHref={severity ? href({ severity: undefined }) : undefined}
            chips={QA_SEVERITIES.map((key) => ({
              key,
              label: domain(`incidentSeverity.${key}`),
              active: severity === key,
              href: href({ severity: severity === key ? undefined : key }),
            }))}
          />
        ) : null}
      </FilterBar>

      <div className="space-y-8">
        {show("holds") ? (
          <section aria-labelledby="holds-heading">
            {sectionHeading(
              "holds-heading",
              t("holds.title"),
              data.holds.total,
              "holds",
              data.holds.rows.length
            )}
            <DataTable
              clientPaging={false}
              caption={t("holds.caption")}
              className="relative"
              captionHidden
              columns={holdColumns}
              rows={data.holds.rows}
              rowKey={(h) => h.holdId}
              empty={emptyFor("holds", <ShieldAlert />)}
              {...sortProps}
            />
            {pager("holds")}
          </section>
        ) : null}

        {LAB_RESULTS_SHOWN && show("tests") ? (
          <section aria-labelledby="tests-heading">
            {sectionHeading(
              "tests-heading",
              t("tests.title"),
              data.tests.total,
              "tests",
              data.tests.rows.length
            )}
            <DataTable
              clientPaging={false}
              caption={t("tests.caption")}
              className="relative"
              captionHidden
              columns={testColumns}
              rows={data.tests.rows}
              rowKey={(r) => r.id}
              empty={emptyFor("tests", <FlaskConical />)}
              {...sortProps}
            />
            {pager("tests")}
          </section>
        ) : null}

        {show("incidents") ? (
          <section aria-labelledby="incidents-heading">
            {sectionHeading(
              "incidents-heading",
              t("incidents.title"),
              data.incidents.total,
              "incidents",
              data.incidents.rows.length
            )}
            <DataTable
              clientPaging={false}
              caption={t("incidents.caption")}
              className="relative"
              captionHidden
              columns={incidentColumns}
              rows={data.incidents.rows}
              rowKey={(i) => i.id}
              empty={emptyFor("incidents", <TriangleAlert />)}
              {...sortProps}
            />
            {pager("incidents")}
          </section>
        ) : null}
      </div>
    </div>
  );
}
