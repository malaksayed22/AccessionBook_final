export const dynamic = "force-dynamic";

import { ArrowDownLeft, ArrowUpRight, FileDown } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { LineQuantity, MaterialTotalsText } from "@/components/MaterialFigures";
import { ShipmentActions } from "@/components/ShipmentActions";
import { EntityLink } from "@/components/page/EntityLink";
import { richValue } from "@/components/page/rich-value";
import { ShipmentStatusBadge, UnitStatusBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonStyles } from "@/components/ui/Button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import {
  getShipmentDetail,
  type ShipmentDetailItem,
  type ShipmentTimelineEntry,
} from "@/features/shipment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { positiveIntParam } from "@/lib/list-params";

type Params = { locale: string; id: string };

const KNOWN_FIELDS = [
  "shippedDate",
  "deliveredDate",
  "trackingNumber",
  "address",
  "licenceNumber",
  "manifestNumber",
  "comment",
] as const;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const t = await getTranslations("materials.detail");
  const user = await requirePageUser();
  const id = positiveIntParam((await params).id);
  const shipment = id ? await getShipmentDetail(user, id) : null;
  return { title: shipment ? t("pageTitle", { reference: shipment.reference }) : t("notFound") };
}

export default async function ShipmentDetailPage({ params }: { params: Promise<Params> }) {
  const locale = await resolveRequestLocale(params);
  const user = await requirePageUser();
  const id = positiveIntParam((await params).id);
  const shipment = id ? await getShipmentDetail(user, id) : null;
  if (!shipment) notFound();

  const t = await getTranslations("materials.detail");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const inbound = shipment.direction === "INBOUND";
  const empty = domain("empty");

  const when = (date: Date | null, style: "date" | "dateTime" = "date") =>
    date ? <time dateTime={date.toISOString()}>{format.dateTime(date, style)}</time> : empty;

  const custody: Array<[string, React.ReactNode]> = [
    [inbound ? t("custody.dispatched") : t("custody.shipped"), when(shipment.shippedDate)],
    [
      inbound ? t("custody.received") : t("custody.delivered"),
      shipment.deliveredDate ? when(shipment.deliveredDate) : t("custody.notDelivered"),
    ],
    [t("custody.tracking"), shipment.trackingNumber ?? empty],
    [t("custody.licence"), shipment.licenceNumber ?? empty],
    [t("custody.recorded"), when(shipment.createdAt, "dateTime")],
  ];

  const columns: Array<Column<ShipmentDetailItem>> = [
    {
      id: "description",
      header: t("lines.description"),
      rowHeader: true,
      cell: (item) => (
        <>
          {item.description}
          {item.comment ? <span className="block text-fg-secondary">{item.comment}</span> : null}
        </>
      ),
    },
    {
      id: "material",
      header: t("lines.material"),
      cell: (item) => domain(`materialClass.${item.materialType}`),
    },
    {
      id: "cultivar",
      header: t("lines.cultivar"),
      cell: (item) => (
        <EntityLink kind="cultivar" id={item.cultivar?.id}>
          {item.cultivar?.name ?? empty}
        </EntityLink>
      ),
    },
    {
      id: "unit",
      header: t("lines.unit"),
      cell: (item) =>
        item.unit && item.unitStanding ? (
          <span className="flex flex-wrap items-center gap-2">
            <EntityLink kind="unit" id={item.unit.id}>
              {item.unit.name}
            </EntityLink>
            <UnitStatusBadge status={item.unitStanding} />
          </span>
        ) : (
          empty
        ),
    },
    {
      id: "quantity",
      header: t("lines.quantity"),
      align: "end",
      cell: (item) => (
        <LineQuantity
          materialType={item.materialType}
          unitCount={item.unitCount}
          weightGrams={item.weightGrams}
          moisture={item.moisture}
        />
      ),
    },
  ];

  const describeEntry = (entry: ShipmentTimelineEntry): string => {
    const status = (value: ShipmentTimelineEntry["statusTo"]) =>
      value ? domain(`shipmentStatus.${value}`) : empty;
    const fields = entry.fields
      .filter((field): field is (typeof KNOWN_FIELDS)[number] =>
        (KNOWN_FIELDS as readonly string[]).includes(field)
      )
      .map((field) => t(`timeline.fields.${field}`))
      .join(", ");
    if (entry.action === "create") return t("timeline.created", { status: status(entry.statusTo) });
    if (entry.statusTo && entry.statusFrom !== entry.statusTo) {
      return fields
        ? t("timeline.statusAndFields", {
            from: status(entry.statusFrom),
            to: status(entry.statusTo),
            fields,
          })
        : t("timeline.statusChanged", {
            from: status(entry.statusFrom),
            to: status(entry.statusTo),
          });
    }
    return fields ? t("timeline.updated", { fields }) : t("timeline.other");
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={<HubCrumbs tab="materials" current={shipment.reference} />}
        title={shipment.reference}
        description={
          <>
            {inbound ? t("receivedFrom") : t("shippedTo")}{" "}
            <EntityLink kind="organization" id={shipment.organization.id}>
              {shipment.organization.name}
            </EntityLink>
            {" · "}
            {t.rich("recordedBy", {
              name: richValue(
                <EntityLink kind="member" id={shipment.recordedById}>
                  {shipment.recordedBy}
                </EntityLink>
              ),
            })}
          </>
        }
        actions={
          <>
            <Badge
              tone={inbound ? "info" : "accent"}
              icon={inbound ? <ArrowDownLeft /> : <ArrowUpRight />}
              href={`/inventory/materials?direction=${shipment.direction}`}
            >
              {domain(`shipmentDirection.${shipment.direction}`)}
            </Badge>
            <ShipmentStatusBadge status={shipment.status} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("custody.title")} />
            <PanelBody>
              <dl className="grid gap-x-6 gap-y-6 sm:grid-cols-3">
                {custody.map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                      {label}
                    </dt>
                    <dd className="mt-1.5 text-sm text-fg wrap-break-word">{value}</dd>
                  </div>
                ))}
              </dl>
            </PanelBody>
          </Panel>

          <section aria-labelledby="lines-heading" className="space-y-2">
            <h2 id="lines-heading" className="text-base font-semibold text-fg">
              {t("lines.title")}{" "}
              <span className="font-normal text-fg-secondary">
                {t("lines.count", { count: shipment.items.length })}
              </span>
            </h2>
            <DataTable
              caption={t("lines.caption")}
              captionHidden
              columns={columns}
              rows={shipment.items}
              rowKey={(item) => item.id}
            />
            <p className="text-sm">
              <span className="text-fg-secondary">{t("lines.manifestTotal")} </span>
              <span className="font-medium">
                <MaterialTotalsText totals={shipment.totals} />
              </span>
            </p>
          </section>

          {shipment.comment ? (
            <Panel>
              <PanelHeader title={t("notes")} />
              <PanelBody>
                <p className="text-sm whitespace-pre-wrap text-fg">{shipment.comment}</p>
              </PanelBody>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          {/* A file from an API route: a plain link, with no language prefix. */}
          <a
            href={`/api/shipments/${shipment.id}/record?locale=${locale}`}
            download
            className={buttonStyles({ variant: "secondary", className: "w-full" })}
          >
            <FileDown aria-hidden="true" className="size-4" />
            {t("custodyPdf")}
          </a>
          <ShipmentActions
            shipmentId={shipment.id}
            reference={shipment.reference}
            direction={shipment.direction}
            status={shipment.status}
            unitLineCount={shipment.unitLineCount}
            trackingNumber={shipment.trackingNumber}
            licenceNumber={shipment.licenceNumber}
            canManage={isAdmin(user)}
          />

          <Panel>
            <PanelHeader title={t("timeline.title")} />
            <PanelBody>
              {shipment.timeline.length === 0 ? (
                <p className="text-sm text-fg-secondary">{t("timeline.empty")}</p>
              ) : (
                <ol className="space-y-3">
                  {shipment.timeline.map((entry) => (
                    <li key={entry.id} className="border-s-2 border-border ps-3 text-sm">
                      <p className="text-fg">{describeEntry(entry)}</p>
                      <p className="text-fg-secondary">
                        {t.rich("timeline.by", {
                          actor: richValue(
                            <EntityLink kind="member" id={entry.actorId}>
                              {entry.actor}
                            </EntityLink>
                          ),
                        })}
                        {" · "}
                        <time dateTime={entry.at.toISOString()}>
                          {format.dateTime(entry.at, "dateTime")}
                        </time>
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
