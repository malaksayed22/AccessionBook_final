export const dynamic = "force-dynamic";

import { FlaskConical, Microscope } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuditActionBadge } from "@/components/AuditLabels";
import { DonutChart, type DonutSlice } from "@/components/charts/DonutChart";
import { CYCLE, STATUS } from "@/components/charts/palette";
import { EntityLink } from "@/components/page/EntityLink";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { auditEntityHref } from "@/features/audit/links";
import { getDashboard, type MemberOverview } from "@/features/dashboard/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("pageTitle") };
}

/** The units list's statuses, in the order the chart and its legend show them. */
const STATUS_SLICES = [
  { key: "active", gradient: STATUS.good },
  { key: "hold", gradient: STATUS.caution },
  { key: "empty", gradient: STATUS.neutral },
  { key: "destroyed", gradient: STATUS.bad },
] as const;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("dashboard");
  const domain = await getTranslations("domain");
  const units = await getTranslations("units.list");
  const format = await getFormatter();

  const data = await getDashboard(user);
  const { inventory, view } = data;
  const isAdminView = view === "admin";
  const count = (value: number) => format.number(value, "count");

  const statusSlices: DonutSlice[] = STATUS_SLICES.map(({ key, gradient }) => ({
    key,
    label: units(`statusOptions.${key}`),
    value: data.statuses[key],
    gradient,
    href: `/inventory/units?status=${key}`,
  })).filter((slice) => slice.value > 0);
  const recorded = statusSlices.reduce((sum, slice) => sum + slice.value, 0);

  const typeSlices: DonutSlice[] = inventory.byType.map(({ key, count: n }, index) => ({
    key,
    label: domain(`unitTypePlural.${key}`),
    value: n,
    gradient: CYCLE[index % CYCLE.length]!,
    href: `/inventory/units?type=${key}`,
  }));
  const stageSlices: DonutSlice[] = inventory.byStage.map(({ key, count: n }, index) => ({
    key,
    label: key === "NONE" ? t("inventory.noStage") : domain(`growthStage.${key}`),
    value: n,
    gradient: CYCLE[index % CYCLE.length]!,
    href: key === "NONE" ? undefined : `/inventory/units?stage=${key}`,
  }));
  // A donut cannot show how full a location is, so its legend gives the capacity, and says when it is full.
  const locationSlices: DonutSlice[] = [
    ...inventory.byLocation.map((location, index) => ({
      key: String(location.id),
      label: location.name,
      note: location.capacity
        ? t(location.count >= location.capacity ? "charts.location.full" : "charts.location.of", {
            capacity: count(location.capacity),
          })
        : undefined,
      value: location.count,
      gradient: CYCLE[index % CYCLE.length]!,
      href: `/inventory/units?location=${location.id}`,
    })),
    ...(inventory.unlocated > 0
      ? [
          {
            key: "none",
            label: t("inventory.noLocation"),
            value: inventory.unlocated,
            gradient: STATUS.neutral,
          },
        ]
      : []),
  ];

  // The centres of the type, stage and location donuts count types, stages and locations, not units again.
  const typesInUse = inventory.byType.length;
  const stagesInUse = inventory.byStage.filter((stage) => stage.key !== "NONE").length;
  const locationsInUse = inventory.byLocation.length + inventory.otherLocations.locations;

  const today = format.dateTime(new Date(), { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-10">
      <PageHeader
        kicker={today}
        title={
          <>
            {t("hero.lead")}{" "}
            <span className="font-serif font-normal tracking-[-0.02em] text-fg-secondary italic">
              {t("hero.accent")}
            </span>
          </>
        }
        description={isAdminView ? t("description.admin") : t("description.member")}
        actions={<Badge tone={isAdminView ? "accent" : "neutral"}>{t(`view.${view}`)}</Badge>}
        className="pb-0"
      />

      <section aria-labelledby="summary-heading" className="space-y-4">
        <div>
          <h2 id="summary-heading" className="text-lg font-semibold text-fg">
            {t("summary.heading")}
          </h2>
          <p className="text-sm text-fg-secondary">
            {isAdminView ? t("summary.description.admin") : t("summary.description.member")}
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Panel className="chart-glow">
            <PanelHeader title={t("inventory.byStatus")} headingLevel={3} />
            <PanelBody>
              {recorded === 0 ? (
                <InventoryEmpty t={t} />
              ) : (
                <DonutChart
                  label={t("inventory.byStatus")}
                  slices={statusSlices}
                  centerValue={count(recorded)}
                  centerLabel={t("charts.recordedCenter")}
                />
              )}
            </PanelBody>
          </Panel>

          <Panel className="chart-glow">
            <PanelHeader title={t("inventory.byType")} headingLevel={3} />
            <PanelBody>
              {inventory.total === 0 ? (
                <InventoryEmpty t={t} />
              ) : (
                <DonutChart
                  label={t("inventory.byType")}
                  slices={typeSlices}
                  centerValue={count(typesInUse)}
                  centerLabel={t("charts.typesCenter", { count: typesInUse })}
                />
              )}
            </PanelBody>
          </Panel>

          <Panel className="chart-glow">
            <PanelHeader title={t("inventory.byStage")} headingLevel={3} />
            <PanelBody>
              {inventory.total === 0 ? (
                <InventoryEmpty t={t} />
              ) : (
                <DonutChart
                  label={t("inventory.byStage")}
                  slices={stageSlices}
                  centerValue={count(stagesInUse)}
                  centerLabel={t("charts.stagesCenter", { count: stagesInUse })}
                />
              )}
            </PanelBody>
          </Panel>

          <Panel className="chart-glow">
            <PanelHeader title={t("charts.location.title")} headingLevel={3} />
            <PanelBody className="space-y-3">
              {inventory.total === 0 ? (
                <InventoryEmpty t={t} />
              ) : (
                <DonutChart
                  label={t("charts.location.title")}
                  slices={locationSlices}
                  centerValue={count(locationsInUse)}
                  centerLabel={t("charts.locationsCenter", { count: locationsInUse })}
                />
              )}
              {inventory.otherLocations.locations > 0 ? (
                <p className="text-sm text-fg-secondary">
                  {t("inventory.otherLocations", { locations: inventory.otherLocations.locations })}
                  {" · "}
                  {count(inventory.otherLocations.units)}
                </p>
              ) : null}
            </PanelBody>
          </Panel>
        </div>
      </section>

      <div className={isAdminView ? "grid gap-6 lg:grid-cols-2" : undefined}>
        {data.members ? <MembersPanel members={data.members} /> : null}

        <Panel>
          <PanelHeader
            title={t("experiments.heading")}
            description={t(
              isAdminView ? "experiments.description.admin" : "experiments.description.member",
              { count: data.runningExperimentCount }
            )}
            actions={
              <Button href="/inventory/experiments" variant="ghost" size="sm">
                {t("experiments.viewAll")}
              </Button>
            }
          />
          {data.runningExperiments.length === 0 ? (
            <EmptyState
              icon={<FlaskConical />}
              title={t("experiments.emptyTitle")}
              description={
                isAdminView ? t("experiments.emptyBody.admin") : t("experiments.emptyBody.member")
              }
              action={
                isAdminView ? (
                  <Button href="/inventory/experiments" variant="primary">
                    {t("experiments.emptyAction")}
                  </Button>
                ) : undefined
              }
              headingLevel={3}
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.runningExperiments.map((experiment) => (
                <li key={experiment.id} className="px-5 py-4 sm:px-6">
                  <EntityLink kind="experiment" id={experiment.id}>
                    <span className="font-mono">{experiment.ecode}</span> {experiment.name}
                  </EntityLink>
                  <p className="mt-0.5 text-sm text-fg-secondary">
                    <Link
                      href={`/inventory/experiments/${experiment.id}`}
                      className="hover:text-accent-text hover:underline"
                    >
                      {t("experiments.units", { count: experiment.activeUnits })}
                    </Link>
                    {" · "}
                    {experiment.endDate
                      ? t("experiments.ends", {
                          date: format.dateTime(experiment.endDate, "date"),
                        })
                      : t("experiments.noEnd")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title={t("recent.heading")}
          description={
            data.recent.kind === "audit"
              ? t("recent.auditDescription")
              : t("recent.eventsDescription")
          }
          actions={
            <Button
              href={data.recent.kind === "audit" ? "/compliance/audit" : "/inventory/units"}
              variant="ghost"
              size="sm"
            >
              {data.recent.kind === "audit" ? t("recent.auditLink") : t("recent.eventsLink")}
            </Button>
          }
        />
        {data.recent.kind === "audit" ? (
          data.recent.entries.length === 0 ? (
            <RecentEmpty t={t} />
          ) : (
            <ul className="divide-y divide-border">
              {data.recent.entries.map((entry) => {
                const href = auditEntityHref(entry.entityType, entry.entityId);
                return (
                  <li key={entry.id} className="px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <AuditActionBadge action={entry.action} />
                      {href ? (
                        <Link href={href} className="font-medium text-accent-text hover:underline">
                          {entry.entityLabel}
                        </Link>
                      ) : (
                        <span className="font-medium text-fg">{entry.entityLabel}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-fg">{entry.summary}</p>
                    <p className="mt-0.5 text-sm text-fg-secondary">
                      <EntityLink
                        kind="member"
                        id={entry.actorId}
                        className="font-normal underline underline-offset-2"
                      >
                        {entry.attempt
                          ? t("recent.attempt")
                          : t("recent.by", { name: entry.actorName })}
                      </EntityLink>
                      {" · "}
                      <time dateTime={entry.createdAt.toISOString()}>
                        {format.dateTime(entry.createdAt, "dateTime")}
                      </time>
                    </p>
                  </li>
                );
              })}
            </ul>
          )
        ) : data.recent.events.length === 0 ? (
          <RecentEmpty t={t} />
        ) : (
          <ul className="divide-y divide-border">
            {data.recent.events.map((event) => (
              <li key={event.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-fg-secondary">
                    {domain(`stateKind.${event.kind}`)}
                  </span>
                  <EntityLink kind="unit" id={event.unitId}>
                    {event.unitName}
                  </EntityLink>
                </div>
                <p className="mt-0.5 text-sm text-fg-secondary">
                  {t("recent.by", { name: event.actorName })}
                  {event.locationName
                    ? ` · ${t("recent.at", { location: event.locationName })}`
                    : ""}
                  {" · "}
                  <time dateTime={event.recordedAt.toISOString()}>
                    {format.dateTime(event.recordedAt, "dateTime")}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"dashboard">>>;

function InventoryEmpty({ t }: { t: T }) {
  return (
    <EmptyState
      icon={<Microscope />}
      title={t("inventory.emptyTitle")}
      description={t("inventory.emptyBody")}
      headingLevel={4}
      className="py-6"
    />
  );
}

function RecentEmpty({ t }: { t: T }) {
  return (
    <EmptyState
      title={t("recent.emptyTitle")}
      description={t("recent.emptyBody")}
      headingLevel={3}
    />
  );
}

/** Administrator view: every active member, with the experiments they belong to and their units. */
async function MembersPanel({ members }: { members: MemberOverview[] }) {
  const t = await getTranslations("dashboard");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  return (
    <Panel>
      <PanelHeader
        title={t("members.heading")}
        description={t("members.description", { count: members.length })}
        actions={
          <Button href="/records/members" variant="ghost" size="sm">
            {t("members.viewAll")}
          </Button>
        }
      />
      <DataTable
        caption={t("members.heading")}
        captionHidden
        density="compact"
        rows={members}
        rowKey={(member) => member.id}
        pageSize={6}
        columns={[
          {
            id: "name",
            header: t("members.columns.name"),
            rowHeader: true,
            cell: (member) => (
              <EntityLink kind="member" id={member.id}>
                {member.name}
              </EntityLink>
            ),
          },
          {
            id: "role",
            header: t("members.columns.role"),
            cell: (member) => domain(`role.${member.permissions}`),
          },
          {
            id: "experiments",
            header: t("members.columns.experiments"),
            align: "end",
            cell: (member) => format.number(member.experiments, "count"),
          },
          {
            id: "units",
            header: t("members.columns.units"),
            align: "end",
            cell: (member) => format.number(member.units, "count"),
          },
        ]}
        empty={<span className="text-fg-secondary">{t("members.empty")}</span>}
      />
    </Panel>
  );
}
