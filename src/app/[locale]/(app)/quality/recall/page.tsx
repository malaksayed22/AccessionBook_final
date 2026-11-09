export const dynamic = "force-dynamic";

import { Download, Search, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { LineageTreeChart, type TreeTone } from "@/components/LineageTreeChart";
import { RecallPrintButton } from "@/components/RecallPrintButton";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { FilterBar } from "@/components/page/FilterBar";
import { SearchForm } from "@/components/page/SearchForm";
import { EntityLink } from "@/components/page/EntityLink";
import {
  HoldBadge,
  ShipmentStatusBadge,
  UnitStatusBadge,
  UnitTypeBadge,
} from "@/components/page/domain-badges";
import { Banner } from "@/components/ui/Banner";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import {
  getRecallTrace,
  searchRecallUnits,
  type RecallNode,
  type RecallTrace,
} from "@/features/qa/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { layoutTree, type TreeRow } from "@/lib/lineage-tree";
import { positiveIntParam } from "@/lib/list-params";

const BASE = "/quality/recall";
type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recall.page");
  return { title: t("pageTitle") };
}

export default async function RecallPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("recall.page");
  const locale = await getLocale();

  // `unitId` is the older link from a unit page; both mean the same thing.
  const unitId = positiveIntParam(raw.unit) ?? positiveIntParam(raw.unitId);
  const q = raw.q?.trim() || undefined;

  const trace = unitId ? await getRecallTrace(user, unitId) : null;
  const hits = !trace && q ? await searchRecallUnits(user, q) : [];
  // One unit whose name or number is exactly what was typed: open its trace without a choice step.
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only && (only.name.toLowerCase() === q?.toLowerCase() || String(only.id) === q)) {
    redirect(`/${locale}${BASE}?unit=${only.id}`);
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          trace ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <RecallPrintButton label={t("print")} />
              {/* A file download from the API, not a page of the app: a plain link, no language prefix. */}
              <a
                href={`/api/recall?unitId=${trace.origin.id}&format=csv&locale=${locale}`}
                className={buttonStyles({ variant: "secondary" })}
              >
                <Download aria-hidden="true" className="size-4" />
                {t("exportCsv")}
              </a>
            </div>
          ) : null
        }
      />

      <FilterBar
        search={
          <SearchForm
            action={BASE}
            params={{}}
            q={q ?? (trace ? trace.origin.name : undefined)}
            label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
          />
        }
      />

      {trace ? (
        <TraceView trace={trace} />
      ) : unitId ? (
        <EmptyState icon={<Search />} title={t("notFoundTitle")} description={t("notFoundBody")} />
      ) : q ? (
        <SearchResults hits={hits} q={q} />
      ) : (
        <EmptyState icon={<Undo2 />} title={t("startTitle")} description={t("startBody")} />
      )}
    </div>
  );
}

async function SearchResults({
  hits,
  q,
}: {
  hits: Awaited<ReturnType<typeof searchRecallUnits>>;
  q: string;
}) {
  const t = await getTranslations("recall.page");
  const domain = await getTranslations("domain");
  if (hits.length === 0) {
    return (
      <EmptyState
        icon={<Search />}
        title={t("noMatchTitle")}
        description={t("noMatchBody", { q })}
      />
    );
  }
  const columns: Array<Column<(typeof hits)[number]>> = [
    {
      id: "unit",
      header: t("results.unit"),
      rowHeader: true,
      cell: (h) => (
        <Link
          href={`/quality/recall?unit=${h.id}`}
          className="font-medium text-accent-text hover:underline"
        >
          {h.name}
        </Link>
      ),
    },
    { id: "type", header: t("results.type"), cell: (h) => <UnitTypeBadge type={h.type} /> },
    {
      id: "cultivar",
      header: t("results.cultivar"),
      cell: (h) =>
        h.cultivar ? (
          <EntityLink kind="cultivar" id={h.cultivarId} className="font-normal">
            {h.cultivar}
          </EntityLink>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "status",
      header: t("results.status"),
      cell: (h) => <UnitStatusBadge status={h.standing} nothingLeft={h.nothingLeft} />,
    },
  ];
  return (
    <section aria-labelledby="results-heading" className="space-y-2">
      <h2 id="results-heading" className="text-base font-semibold text-fg">
        {t("results.title", { count: hits.length })}
      </h2>
      <DataTable
        caption={t("results.caption")}
        captionHidden
        columns={columns}
        rows={hits}
        rowKey={(h) => h.id}
      />
    </section>
  );
}

async function TraceView({ trace }: { trace: RecallTrace }) {
  const t = await getTranslations("recall.page");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const { origin, counts } = trace;
  const empty = domain("empty");

  // The lineage as a tree: the mother line runs down to the traced unit, and everything derived from
  // it branches below, each unit under the one it came from.
  const lineageInput = [
    ...trace.upstream.map((n, index) => ({
      id: n.id,
      parentId: index > 0 ? trace.upstream[index - 1]!.id : null,
      item: n,
    })),
    { id: origin.id, parentId: trace.upstream.at(-1)?.id ?? null, item: origin },
    ...trace.downstream.map((n) => ({ id: n.id, parentId: n.parentId ?? origin.id, item: n })),
  ];
  const lineage = layoutTree<RecallNode>(lineageInput);
  const lineageParent = new Map(lineageInput.map((n) => [n.id, n.parentId]));
  const toneOf = (n: RecallNode): TreeTone =>
    n.standing === "destroyed"
      ? "destroyed"
      : n.nothingLeft
        ? "inactive"
        : n.standing === "on-hold"
          ? "hold"
          : "active";
  const shipmentById = new Map(trace.shipments.map((s) => [s.id, s]));

  const shippedTo = (n: RecallNode, label: string) => (
    <>
      {label}{" "}
      {n.shippedTo.map((org, index) => (
        <span key={org.id}>
          {index > 0 ? ", " : null}
          <Link href={`/records/organizations/${org.id}`} className="hover:underline">
            {org.name}
          </Link>
        </span>
      ))}
    </>
  );

  const custody = (n: RecallNode) => {
    if (n.standing === "destroyed") return t("custody.destroyed");
    if (n.nothingLeft) {
      return n.shippedTo.length > 0 ? shippedTo(n, t("custody.shippedTo")) : t("custody.shipped");
    }
    const here = n.locationName ? (
      <EntityLink kind="location" id={n.locationId} className="font-normal">
        {t("custody.at", { location: n.locationName })}
      </EntityLink>
    ) : (
      empty
    );
    if (n.shippedTo.length === 0) return here;
    return (
      <>
        {here}
        <span className="block text-fg-secondary">{shippedTo(n, t("custody.partShippedTo"))}</span>
      </>
    );
  };

  const holdCell = (n: RecallNode) =>
    n.hold && n.standing !== "destroyed" && !n.nothingLeft ? (
      <>
        <HoldBadge kind={n.hold.kind} />
        <span className="block text-fg-secondary">{n.hold.reason}</span>
      </>
    ) : (
      empty
    );

  const unitColumn: Column<TreeRow<RecallNode>> = {
    id: "unit",
    header: t("lineage.unit"),
    rowHeader: true,
    cell: (row) => {
      const n = row.item;
      return (
        <>
          <Link
            href={
              n.relation === "self" ? `/inventory/units/${n.id}` : `/quality/recall?unit=${n.id}`
            }
            className="font-medium text-accent-text hover:underline"
          >
            {n.name}
          </Link>
          <span className="block text-fg-secondary">
            {n.relation === "self"
              ? t("relation.self")
              : row.depth === 0
                ? t("lineage.root")
                : t("lineage.generation", { generation: row.depth })}
          </span>
        </>
      );
    },
  };
  const columns: Array<Column<TreeRow<RecallNode>>> = [
    unitColumn,
    {
      id: "type",
      header: t("lineage.type"),
      cell: ({ item: n }) => <UnitTypeBadge type={n.type} />,
    },
    {
      id: "status",
      header: t("lineage.status"),
      cell: ({ item: n }) => <UnitStatusBadge status={n.standing} nothingLeft={n.nothingLeft} />,
    },
    { id: "hold", header: t("lineage.hold"), cell: ({ item }) => holdCell(item) },
    { id: "custody", header: t("lineage.custody"), cell: ({ item }) => custody(item) },
    {
      id: "origin",
      header: t("lineage.source"),
      cell: ({ item: n }) => (
        <>
          {n.cultivar ? (
            <EntityLink kind="cultivar" id={n.cultivarId} className="font-normal">
              {n.cultivar}
            </EntityLink>
          ) : (
            empty
          )}
          {n.experiment ? (
            <EntityLink kind="experiment" id={n.experiment.id} className="block font-normal">
              {n.experiment.ecode}
            </EntityLink>
          ) : null}
        </>
      ),
    },
    {
      id: "shipments",
      header: t("lineage.shipments"),
      cell: ({ item: n }) =>
        n.shipmentIds.length === 0 ? (
          empty
        ) : (
          <span className="flex flex-col gap-0.5">
            {n.shipmentIds.map((id) => (
              <Link key={id} href={`/inventory/materials/${id}`} className="hover:underline">
                {shipmentById.get(id)?.reference ?? id}
              </Link>
            ))}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <Panel>
        <PanelBody>
          <p className="text-sm text-fg-secondary">{t("origin.label")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              href={`/inventory/units/${origin.id}`}
              className="text-2xl font-semibold text-accent-text hover:underline"
            >
              {origin.name}
            </Link>
            <UnitTypeBadge type={origin.type} />
            <UnitStatusBadge status={origin.standing} />
          </p>
          <p className="mt-2 text-sm text-fg-secondary">
            {origin.cultivar || origin.experiment ? (
              <>
                {origin.cultivar ? (
                  <EntityLink kind="cultivar" id={origin.cultivarId} className="font-normal">
                    {origin.cultivar}
                  </EntityLink>
                ) : null}
                {origin.cultivar && origin.experiment ? " · " : null}
                {origin.experiment ? (
                  <EntityLink kind="experiment" id={origin.experiment.id} className="font-normal">
                    {origin.experiment.ecode}
                  </EntityLink>
                ) : null}
              </>
            ) : (
              empty
            )}
            {" · "}
            {custody(origin)}
          </p>
          {origin.hold ? (
            <Banner tone="warning" title={t("origin.heldTitle")} className="mt-4">
              {t("origin.heldBody", {
                origin: domain(`holdOrigin.${origin.hold.origin}`),
                reason: origin.hold.reason,
                date: format.dateTime(origin.hold.placedAt, "dateTime"),
              })}
            </Banner>
          ) : null}
        </PanelBody>
      </Panel>

      <StatusDonut
        title={t("counts.chartTitle")}
        slices={(
          [
            ["active", STATUS.good],
            ["hold", STATUS.caution],
            ["inactive", STATUS.neutral],
            ["destroyed", STATUS.bad],
          ] as const
        ).map(([key, gradient]) => ({
          key,
          label: t(`lineage.legend.${key}`),
          value: lineage.filter((row) => toneOf(row.item) === key).length,
          gradient,
        }))}
        centerValue={format.number(lineage.length, "count")}
        centerLabel={t("counts.chartCenter")}
        footer={
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <span>{t("counts.upLine", { count: counts.upstream })}</span>
            <span>{t("counts.downLine", { count: counts.downstream })}</span>
            <Link href="/records/organizations" className="hover:text-accent-text hover:underline">
              {t("counts.orgLine", {
                count: counts.organizations,
                shipments: counts.shipments,
              })}
            </Link>
          </p>
        }
      />

      {trace.truncated ? (
        <Banner tone="warning" title={t("truncatedTitle")}>
          {t("truncatedBody", { count: counts.downstream })}
        </Banner>
      ) : null}

      <section aria-labelledby="lineage-heading" className="space-y-2">
        <h2 id="lineage-heading" className="text-lg font-semibold text-fg">
          {t("lineage.title")}
        </h2>
        <p className="text-sm text-fg-secondary">{t("lineage.hint")}</p>
        <LineageTreeChart
          tracedId={origin.id}
          units={lineage.map((row) => ({
            id: row.id,
            parentId:
              row.item.relation === "self"
                ? (trace.upstream.at(-1)?.id ?? null)
                : (lineageParent.get(row.id) ?? null),
            name: row.item.name,
            tone: toneOf(row.item),
            href:
              row.item.relation === "self"
                ? `/inventory/units/${row.id}`
                : `/quality/recall?unit=${row.id}`,
          }))}
          labels={{
            title: t("lineage.treeTitle"),
            rectangular: t("lineage.rectangular"),
            circular: t("lineage.circular"),
            forward: t("lineage.forward"),
            earliest: t("lineage.earliest"),
            latest: t("lineage.latest"),
            legend: {
              active: t("lineage.legend.active"),
              hold: t("lineage.legend.hold"),
              inactive: t("lineage.legend.inactive"),
              destroyed: t("lineage.legend.destroyed"),
              traced: t("lineage.legend.traced"),
              clade: t("lineage.legend.clade"),
            },
          }}
        />
        <DataTable
          caption={t("lineage.caption", { name: origin.name })}
          captionHidden
          columns={columns}
          rows={lineage}
          rowKey={(row) => row.id}
          density="compact"
        />
      </section>

      <section aria-labelledby="orgs-heading" className="space-y-2">
        <h2 id="orgs-heading" className="text-lg font-semibold text-fg">
          {t("organizations.title")}
        </h2>
        <DataTable
          caption={t("organizations.caption")}
          captionHidden
          columns={[
            {
              id: "name",
              header: t("organizations.name"),
              rowHeader: true,
              cell: (o) => (
                <Link
                  href={`/records/organizations/${o.id}`}
                  className="font-medium text-accent-text hover:underline"
                >
                  {o.name}
                </Link>
              ),
            },
            {
              id: "licence",
              header: t("organizations.licence"),
              cell: (o) => o.licenceNumber ?? empty,
            },
            {
              id: "units",
              header: t("organizations.units"),
              align: "end",
              cell: (o) => format.number(o.unitCount, "count"),
            },
            {
              id: "shipments",
              header: t("organizations.shipments"),
              cell: (o) => (
                <span className="flex flex-wrap gap-x-3">
                  {o.shipmentIds.map((id) => (
                    <Link key={id} href={`/inventory/materials/${id}`} className="hover:underline">
                      {shipmentById.get(id)?.reference ?? id}
                    </Link>
                  ))}
                </span>
              ),
            },
          ]}
          rows={trace.organizations}
          rowKey={(o) => o.id}
          empty={<span className="text-fg-secondary">{t("organizations.none")}</span>}
        />
      </section>

      <section aria-labelledby="shipments-heading" className="space-y-2">
        <h2 id="shipments-heading" className="text-lg font-semibold text-fg">
          {t("shipments.title")}
        </h2>
        <DataTable
          caption={t("shipments.caption")}
          captionHidden
          columns={[
            {
              id: "reference",
              header: t("shipments.reference"),
              rowHeader: true,
              cell: (s) => (
                <Link
                  href={`/inventory/materials/${s.id}`}
                  className="font-medium text-accent-text hover:underline"
                >
                  {s.reference}
                </Link>
              ),
            },
            {
              id: "direction",
              header: t("shipments.direction"),
              cell: (s) => <Badge>{domain(`shipmentDirection.${s.direction}`)}</Badge>,
            },
            {
              id: "status",
              header: t("shipments.status"),
              cell: (s) => <ShipmentStatusBadge status={s.status} />,
            },
            {
              id: "org",
              header: t("shipments.organization"),
              cell: (s) => (
                <EntityLink kind="organization" id={s.organization.id} className="font-normal">
                  {s.organization.name}
                </EntityLink>
              ),
            },
            {
              id: "units",
              header: t("shipments.units"),
              cell: (s) => (
                <span className="flex flex-wrap gap-x-3">
                  {s.units.map((unit) => (
                    <EntityLink key={unit.id} kind="unit" id={unit.id} className="font-normal">
                      {unit.name}
                    </EntityLink>
                  ))}
                </span>
              ),
            },
          ]}
          rows={trace.shipments}
          rowKey={(s) => s.id}
          empty={<span className="text-fg-secondary">{t("shipments.none")}</span>}
        />
      </section>

      {trace.sameCultivar.length > 0 ? (
        <Panel className="print:hidden">
          <PanelHeader
            title={t("peers.title", { count: trace.sameCultivarTotal })}
            description={t("peers.hint", { cultivar: origin.cultivar ?? empty })}
          />
          <PanelBody>
            <DataTable
              caption={t("peers.caption")}
              captionHidden
              density="compact"
              columns={[
                {
                  id: "unit",
                  header: t("lineage.unit"),
                  rowHeader: true,
                  cell: (n) => (
                    <Link
                      href={`/quality/recall?unit=${n.id}`}
                      className="font-medium text-accent-text hover:underline"
                    >
                      {n.name}
                    </Link>
                  ),
                },
                {
                  id: "type",
                  header: t("lineage.type"),
                  cell: (n) => <UnitTypeBadge type={n.type} />,
                },
                { id: "hold", header: t("lineage.hold"), cell: holdCell },
                { id: "custody", header: t("lineage.custody"), cell: custody },
              ]}
              rows={trace.sameCultivar}
              rowKey={(n) => n.id}
            />
            {trace.sameCultivarTotal > trace.sameCultivar.length ? (
              <p className="mt-2 text-sm text-fg-secondary">
                {t("peers.more", {
                  shown: trace.sameCultivar.length,
                  total: trace.sameCultivarTotal,
                })}
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
