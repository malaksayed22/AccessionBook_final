export const dynamic = "force-dynamic";

import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { LocationOccupancy } from "@/components/LocationOccupancy";
import { LocationRowActions } from "@/components/LocationRowActions";
import { EntityLink } from "@/components/page/EntityLink";
import { HoldBadge, UnitTypeBadge } from "@/components/page/domain-badges";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { getLocationProfile, UNITS_SHOWN, type LocationProfile } from "@/features/location/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";
import { positiveIntParam } from "@/lib/list-params";
import { canManageLocations } from "@/lib/roles";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("locations.profile");
  const { id } = await params;
  const numeric = positiveIntParam(id);
  const user = await requirePageUser();
  const location = numeric ? await getLocationProfile(user, numeric) : null;
  return { title: location ? location.name : t("pageTitle") };
}

/** A room's own page: what it is, how full it is and the units stored there now. */
export default async function LocationProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  await resolveRequestLocale(params);
  const { id } = await params;
  const user = await requirePageUser();
  const numeric = positiveIntParam(id);
  if (!numeric) notFound();
  const location = await getLocationProfile(user, numeric);
  if (!location) notFound();

  const t = await getTranslations("locations");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const empty = domain("empty");
  const held = location.occupancy.units > 0 ? location.statuses.onHold : 0;

  const capacityText =
    location.capacity === null
      ? t("list.noLimit")
      : location.capacityMeasure === "WEIGHT"
        ? t("list.capacityWeight", { kg: location.capacity / 1000 })
        : t(location.capacityMeasure === "PLANTS" ? "list.capacityPlants" : "list.capacityUnits", {
            count: location.capacity,
          });
  const filled =
    location.capacityMeasure === "PLANTS"
      ? location.occupancy.plants
      : location.capacityMeasure === "WEIGHT"
        ? location.occupancy.grams
        : location.occupancy.units;

  const columns: Array<Column<LocationProfile["units"][number]>> = [
    {
      id: "unit",
      header: t("profile.units.unit"),
      rowHeader: true,
      cell: (u) => (
        <EntityLink kind="unit" id={u.id}>
          {u.name}
        </EntityLink>
      ),
    },
    { id: "type", header: t("profile.units.type"), cell: (u) => <UnitTypeBadge type={u.type} /> },
    {
      id: "cultivar",
      header: t("profile.units.cultivar"),
      cell: (u) =>
        u.cultivar ? (
          <EntityLink kind="cultivar" id={u.cultivar.id}>
            {u.cultivar.name}
          </EntityLink>
        ) : (
          empty
        ),
    },
    {
      id: "experiment",
      header: t("profile.units.experiment"),
      cell: (u) =>
        u.experiment ? (
          <EntityLink kind="experiment" id={u.experiment.id}>
            {u.experiment.ecode}
          </EntityLink>
        ) : (
          empty
        ),
    },
    {
      id: "hold",
      header: t("profile.units.hold"),
      cell: (u) => (u.held ? <HoldBadge kind="HOLD" /> : empty),
    },
    {
      id: "since",
      header: t("profile.units.since"),
      cell: (u) => <time dateTime={u.since.toISOString()}>{format.dateTime(u.since, "date")}</time>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="locations" current={location.name} />}
        title={
          <>
            {location.code ? (
              <span className="me-3 font-mono text-fg-secondary">{location.code}</span>
            ) : null}
            {location.name}
          </>
        }
        description={location.comment ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={location.active ? "success" : "neutral"}>
              {t(`status.${location.active ? "active" : "retired"}`)}
            </Badge>
            <Button href={`/inventory/units?location=${location.id}`} variant="secondary">
              {t("profile.unitsList")}
            </Button>
            {canManageLocations(user) ? (
              <LocationRowActions
                location={{
                  id: location.id,
                  name: location.name,
                  code: location.code,
                  address: location.address,
                  comment: location.comment,
                  capacity: location.capacity,
                  capacityMeasure: location.capacityMeasure,
                  active: location.active,
                  units: location.occupancy.units,
                }}
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t("profile.details")} />
          <PanelBody>
            <dl className="grid gap-x-6 gap-y-6 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("form.code")}
                </dt>
                <dd className="mt-1.5 font-mono font-medium">{location.code ?? empty}</dd>
              </div>
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("list.columns.capacity")}
                </dt>
                <dd className="mt-1.5 font-medium">{capacityText}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("form.comment")}
                </dt>
                <dd className="mt-1.5 font-medium whitespace-pre-wrap">
                  {location.comment ?? empty}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("form.address")}
                </dt>
                <dd className="mt-1.5 font-medium">{location.address ?? empty}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="mb-2 font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("list.columns.occupancy")}
                </dt>
                <dd>
                  <LocationOccupancy
                    name={location.name}
                    units={filled}
                    capacity={location.capacity}
                    measure={location.capacityMeasure}
                  />
                </dd>
              </div>
            </dl>
          </PanelBody>
        </Panel>

        <StatusDonut
          className="mb-0 lg:max-w-none"
          title={t("profile.chartTitle")}
          slices={[
            {
              key: "active",
              label: domain("unitStatus.active"),
              value: location.occupancy.units - held,
              gradient: STATUS.good,
            },
            {
              key: "on-hold",
              label: domain("unitStatus.on-hold"),
              value: held,
              gradient: STATUS.caution,
            },
          ]}
          centerValue={format.number(location.occupancy.units, "count")}
          centerLabel={t("profile.chartCenter")}
          empty={<p className="text-sm text-fg-secondary">{t("profile.emptyRoom")}</p>}
          footer={t("profile.experimentsLine", { count: location.occupancy.experiments })}
        />
      </div>

      <section aria-labelledby="room-units" className="space-y-2">
        <h2 id="room-units" className="text-lg font-semibold text-fg">
          {t("profile.units.title")}
        </h2>
        {location.occupancy.units > UNITS_SHOWN ? (
          <p className="text-sm text-fg-secondary">
            {t("profile.units.more", { shown: UNITS_SHOWN, total: location.occupancy.units })}
          </p>
        ) : null}
        <DataTable
          caption={t("profile.units.caption", { name: location.name })}
          captionHidden
          columns={columns}
          rows={location.units}
          rowKey={(u) => u.id}
          empty={
            <EmptyState
              icon={<MapPin />}
              title={t("profile.emptyRoom")}
              description={t("profile.emptyRoomBody")}
              headingLevel={3}
            />
          }
        />
      </section>
    </div>
  );
}
