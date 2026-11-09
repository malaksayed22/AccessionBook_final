export const dynamic = "force-dynamic";

import { Boxes, FlaskConical, TriangleAlert } from "lucide-react";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CultivarFormButton } from "@/components/CultivarFormDialog";
import { SeverityBadge, UnitStatusBadge, UnitTypeBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityLink } from "@/components/page/EntityLink";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import {
  CULTIVAR_UNIT_SORTS,
  getCultivar,
  listCultivarIncidents,
  listCultivarTests,
  listCultivarUnits,
  type CultivarIncidentRow,
  type CultivarTestRow,
  type CultivarUnitRow,
} from "@/features/cultivar/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { buildListUrl, pickParam, positiveIntParam } from "@/lib/list-params";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";

const UNITS_PAGE_SIZE = 10;

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("cultivars.detail");
  const { id } = await params;
  return { title: t("pageTitle", { id }) };
}

export default async function CultivarDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const { id: rawId } = await params;
  const raw = await searchParams;
  const id = positiveIntParam(rawId);
  if (!id) notFound();

  const unitsSort = pickParam(raw.sort, CULTIVAR_UNIT_SORTS) ?? "name";
  const unitsOrder = raw.order === "desc" ? "desc" : "asc";
  const unitsPage = positiveIntParam(raw.page) ?? 1;

  const cultivar = await getCultivar(user, id);
  if (!cultivar) notFound();

  const [units, incidents, tests] = await Promise.all([
    listCultivarUnits(user, id, {
      sort: unitsSort,
      order: unitsOrder,
      page: unitsPage,
      limit: UNITS_PAGE_SIZE,
    }),
    listCultivarIncidents(user, id),
    listCultivarTests(user, id),
  ]);

  const t = await getTranslations("cultivars");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const canManage = isAdmin(user);

  const base = `/records/cultivars/${id}`;
  const unitsHref = (overrides: Record<string, string | number | undefined>) =>
    buildListUrl(base, { sort: unitsSort, order: unitsOrder }, overrides);
  const potency = (value: number | null) =>
    value === null ? domain("empty") : format.number(value / 100, "percent");
  const subtitle = [cultivar.code, cultivar.commonName, cultivar.category]
    .filter(Boolean)
    .join(" · ");

  const unitColumns: Array<Column<CultivarUnitRow>> = [
    {
      id: "name",
      header: t("detail.units.columns.name"),
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
      header: t("detail.units.columns.type"),
      sortKey: "type",
      cell: (u) => <UnitTypeBadge type={u.type} />,
    },
    {
      id: "experiment",
      header: t("detail.units.columns.experiment"),
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
      header: t("detail.units.columns.location"),
      cell: (u) =>
        u.locationName ? (
          <EntityLink kind="location" id={u.locationId}>
            {u.locationName}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "status",
      header: t("detail.units.columns.status"),
      cell: (u) => <UnitStatusBadge status={u.status} />,
    },
  ];

  const incidentColumns: Array<Column<CultivarIncidentRow>> = [
    {
      id: "title",
      header: t("detail.incidents.columns.title"),
      rowHeader: true,
      cell: (i) => (
        <Link
          href="/quality?view=incidents"
          className="font-medium text-accent-text hover:underline"
        >
          {i.title}
        </Link>
      ),
    },
    {
      id: "unit",
      header: t("detail.incidents.columns.unit"),
      cell: (i) =>
        i.unit ? (
          <EntityLink kind="unit" id={i.unit.id}>
            {i.unit.name}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "severity",
      header: t("detail.incidents.columns.severity"),
      cell: (i) => <SeverityBadge severity={i.severity} />,
    },
    {
      id: "status",
      header: t("detail.incidents.columns.status"),
      cell: (i) => (
        <Link href="/quality?view=incidents" className="text-accent-text hover:underline">
          {domain(`incidentStatus.${i.status}`)}
        </Link>
      ),
    },
    {
      id: "date",
      header: t("detail.incidents.columns.date"),
      cell: (i) => (
        <time dateTime={i.createdAt.toISOString()}>{format.dateTime(i.createdAt, "date")}</time>
      ),
    },
  ];

  const testColumns: Array<Column<CultivarTestRow>> = [
    {
      id: "unit",
      header: t("detail.tests.columns.unit"),
      rowHeader: true,
      cell: (r) => (
        <Link
          href={`/inventory/units/${r.unit.id}`}
          className="font-medium text-accent-text hover:underline"
        >
          {r.unit.name}
        </Link>
      ),
    },
    {
      id: "test",
      header: t("detail.tests.columns.test"),
      cell: (r) => (
        <Link href="/quality?view=tests" className="text-accent-text hover:underline">
          {`${domain(`testPanel.${r.panel}`)}${r.analyte ? ` · ${r.analyte}` : ""}`}
        </Link>
      ),
    },
    {
      id: "lab",
      header: t("detail.tests.columns.lab"),
      cell: (r) => r.labName ?? domain("empty"),
    },
    {
      id: "value",
      header: t("detail.tests.columns.value"),
      align: "end",
      cell: (r) =>
        r.value === null ? (
          domain("empty")
        ) : (
          <span className="tabular-nums">
            {format.number(r.value, { maximumFractionDigits: 3 })}
            {r.uom ? ` ${r.uom}` : ""}
          </span>
        ),
    },
    {
      id: "date",
      header: t("detail.tests.columns.date"),
      cell: (r) => (
        <time dateTime={r.testedAt.toISOString()}>{format.dateTime(r.testedAt, "date")}</time>
      ),
    },
  ];

  const { stats } = cultivar;
  const statuses = cultivar.details.statuses;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="cultivars" current={cultivar.name} />}
        title={cultivar.name}
        description={subtitle || t("detail.noDetails")}
        actions={
          <>
            <Button
              href={buildListUrl("/inventory/units", { q: cultivar.name })}
              variant="secondary"
            >
              {t("detail.viewUnits")}
            </Button>
            {canManage ? (
              <CultivarFormButton
                cultivar={{
                  id: cultivar.id,
                  name: cultivar.name,
                  code: cultivar.code,
                  commonName: cultivar.commonName,
                  category: cultivar.category,
                  targetThc: cultivar.targetThc,
                  targetCbd: cultivar.targetCbd,
                  vegetativeDays: cultivar.vegetativeDays,
                  floweringDays: cultivar.floweringDays,
                  expectedYieldGrams: cultivar.expectedYieldGrams,
                  comment: cultivar.comment,
                }}
              />
            ) : null}
          </>
        }
        className="pb-0"
      />

      <StatusDonut
        title={t("detail.stats.chartTitle")}
        slices={(
          [
            ["active", statuses.active, STATUS.good],
            ["on-hold", statuses.onHold, STATUS.caution],
            ["nothingLeft", statuses.inactive, STATUS.neutral],
            ["destroyed", statuses.destroyed, STATUS.bad],
          ] as const
        ).map(([key, value, gradient]) => ({
          key,
          label: domain(`unitStatus.${key}`),
          value,
          gradient,
        }))}
        centerValue={format.number(stats.totalUnits, "count")}
        centerLabel={t("detail.stats.chartCenter")}
        empty={<p className="text-sm text-fg-secondary">{t("detail.stats.noUnits")}</p>}
        footer={
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <span>{t("detail.stats.experimentsLine", { count: stats.experiments })}</span>
            <span>{t("detail.stats.locationsLine", { count: stats.locations })}</span>
          </p>
        }
      />

      <Panel>
        <PanelHeader title={t("detail.profile.title")} />
        <PanelBody>
          <dl className="grid gap-x-8 gap-y-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.targetThc")}
              </dt>
              <dd className="mt-1.5 text-base font-medium tabular-nums">
                {potency(cultivar.targetThc)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.targetCbd")}
              </dt>
              <dd className="mt-1.5 text-base font-medium tabular-nums">
                {potency(cultivar.targetCbd)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.vegetativeDays")}
              </dt>
              <dd className="mt-1.5 text-base font-medium tabular-nums">
                {cultivar.vegetativeDays === null
                  ? t("detail.profile.notSet")
                  : t("detail.profile.days", { count: cultivar.vegetativeDays })}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.floweringDays")}
              </dt>
              <dd className="mt-1.5 text-base font-medium tabular-nums">
                {cultivar.floweringDays === null
                  ? t("detail.profile.notSet")
                  : t("detail.profile.days", { count: cultivar.floweringDays })}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.expectedYield")}
              </dt>
              <dd className="mt-1.5 text-base font-medium tabular-nums">
                {cultivar.expectedYieldGrams === null
                  ? t("detail.profile.notSet")
                  : t("detail.profile.perPlant", {
                      value: format.number(cultivar.expectedYieldGrams, "grams"),
                    })}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.category")}
              </dt>
              <dd className="mt-1.5 text-base">
                {cultivar.category ? (
                  <Link
                    href={buildListUrl("/records/cultivars", { q: cultivar.category })}
                    className="text-accent-text hover:underline"
                  >
                    {cultivar.category}
                  </Link>
                ) : (
                  domain("empty")
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.updated")}
              </dt>
              <dd className="mt-1.5 text-base">{format.dateTime(cultivar.updatedAt, "date")}</dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("detail.profile.notes")}
              </dt>
              <dd className="mt-1.5 whitespace-pre-line">{cultivar.comment ?? domain("empty")}</dd>
            </div>
          </dl>
        </PanelBody>
      </Panel>

      <section aria-labelledby="cultivar-units">
        <h2 id="cultivar-units" className="mb-3 text-lg font-semibold">
          {t("detail.units.title")}
        </h2>
        <DataTable
          clientPaging={false}
          caption={t("detail.units.caption", { name: cultivar.name })}
          captionHidden
          columns={unitColumns}
          rows={units.rows}
          rowKey={(u) => u.id}
          sort={{ sort: unitsSort, order: unitsOrder }}
          buildSortHref={(key, order) => unitsHref({ sort: key, order })}
          empty={
            <EmptyState
              icon={<Boxes />}
              title={t("detail.units.emptyTitle")}
              description={t("detail.units.emptyBody")}
              headingLevel={3}
            />
          }
        />
        <Pagination
          className="mt-4"
          page={unitsPage}
          pageSize={UNITS_PAGE_SIZE}
          total={units.total}
          buildHref={(page) => unitsHref({ page })}
        />
      </section>

      <section aria-labelledby="cultivar-incidents">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 id="cultivar-incidents" className="text-lg font-semibold">
            {t("detail.incidents.title")}
          </h2>
          {incidents.total > 0 ? (
            <Badge tone="warning" icon={<TriangleAlert />} href="/quality?view=incidents">
              {t("detail.incidents.total", { count: incidents.total })}
            </Badge>
          ) : null}
        </div>
        <DataTable
          caption={t("detail.incidents.title")}
          captionHidden
          columns={incidentColumns}
          rows={incidents.rows}
          rowKey={(i) => i.id}
          empty={
            <EmptyState
              icon={<TriangleAlert />}
              title={t("detail.incidents.emptyTitle")}
              description={t("detail.incidents.emptyBody")}
              headingLevel={3}
            />
          }
        />
        {incidents.total > incidents.rows.length ? (
          <p className="mt-2 text-sm text-fg-secondary">
            {t("detail.latest", { shown: incidents.rows.length, total: incidents.total })}
          </p>
        ) : null}
      </section>

      {LAB_RESULTS_SHOWN ? (
        <section aria-labelledby="cultivar-tests">
          <h2 id="cultivar-tests" className="mb-3 text-lg font-semibold">
            {t("detail.tests.title")}
          </h2>
          <DataTable
            caption={t("detail.tests.title")}
            captionHidden
            columns={testColumns}
            rows={tests.rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={<FlaskConical />}
                title={t("detail.tests.emptyTitle")}
                description={t("detail.tests.emptyBody")}
                headingLevel={3}
              />
            }
          />
          {tests.total > tests.rows.length ? (
            <p className="mt-2 text-sm text-fg-secondary">
              {t("detail.latest", { shown: tests.rows.length, total: tests.total })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
