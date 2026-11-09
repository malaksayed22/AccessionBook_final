import "server-only";
import { getTranslations } from "next-intl/server";
import { joined, recordContext, type RecordFile } from "@/features/record/common";
import type { AppLocale } from "@/i18n/routing";
import type { SessionUser } from "@/lib/auth";
import type { PdfSection } from "@/lib/pdf/record-pdf";
import { env } from "@/server/env";
import { getShipmentDetail } from "./queries";

/**
 * A shipment's chain of custody as a PDF, to travel with the material: the counterparty and its
 * licence, the dates and tracking number, every line with its quantity, the totals, the custody
 * history (who recorded each step, when), and lines for the releasing and receiving signatures.
 * Null when the shipment does not exist or is outside the user's scope, exactly like its page.
 */
export async function buildShipmentRecord(
  user: SessionUser,
  shipmentId: number,
  locale: AppLocale
): Promise<RecordFile | null> {
  const shipment = await getShipmentDetail(user, shipmentId);
  if (!shipment) return null;

  const ctx = await recordContext(locale, user);
  const t = await getTranslations({ locale, namespace: "recordPdf.shipment" });
  const { domain, empty, when, day, grams, count, table } = ctx;

  const details = [
    { label: t("fields.reference"), value: shipment.reference },
    { label: t("fields.direction"), value: domain(`shipmentDirection.${shipment.direction}`) },
    { label: t("fields.status"), value: domain(`shipmentStatus.${shipment.status}`) },
    { label: t("fields.organization"), value: shipment.organization.name },
    {
      label: t("fields.organizationLicence"),
      value: shipment.organization.licenceNumber ?? empty,
    },
    { label: t("fields.licence"), value: shipment.licenceNumber ?? empty },
    { label: t("fields.shipped"), value: shipment.shippedDate ? day(shipment.shippedDate) : empty },
    {
      label: t("fields.delivered"),
      value: shipment.deliveredDate ? day(shipment.deliveredDate) : t("notDelivered"),
    },
    { label: t("fields.tracking"), value: shipment.trackingNumber ?? empty },
    {
      label: t("fields.recordedBy"),
      value: `${shipment.recordedBy} · ${when(shipment.createdAt)}`,
    },
  ];

  const quantity = (item: (typeof shipment.items)[number]) =>
    item.unitCount !== null
      ? count(item.unitCount)
      : item.weightGrams !== null
        ? ctx.t(item.moisture === "DRY" ? "dryValue" : "wetValue", {
            value: grams(item.weightGrams),
          })
        : empty;
  const lines = table(
    [
      { header: t("columns.line"), width: 0.5, align: "end" },
      { header: t("columns.description"), width: 3 },
      { header: t("columns.material"), width: 1.6 },
      { header: t("columns.unit"), width: 2.2 },
      { header: t("columns.cultivar"), width: 1.8 },
      { header: t("columns.quantity"), width: 1.6, align: "end" },
    ],
    shipment.items.map((item, index) => [
      String(index + 1),
      joined([item.description, item.comment], empty),
      domain(`materialClass.${item.materialType}`),
      item.unit?.name ?? empty,
      item.cultivar?.name ?? empty,
      quantity(item),
    ])
  );
  const totals = shipment.totals;
  const figures = [
    ...(totals.plants ? [{ label: t("totals.plants"), value: count(totals.plants) }] : []),
    ...(totals.clones ? [{ label: t("totals.clones"), value: count(totals.clones) }] : []),
    ...(totals.seeds ? [{ label: t("totals.seeds"), value: count(totals.seeds) }] : []),
    ...(totals.cultures ? [{ label: t("totals.cultures"), value: count(totals.cultures) }] : []),
    ...(totals.wetGrams ? [{ label: t("totals.wet"), value: grams(totals.wetGrams) }] : []),
    ...(totals.dryGrams ? [{ label: t("totals.dry"), value: grams(totals.dryGrams) }] : []),
  ];
  const history = table(
    [
      { header: t("columns.when"), width: 2 },
      { header: t("columns.by"), width: 1.8 },
      { header: t("columns.step"), width: 4 },
    ],
    [...shipment.timeline].reverse().map((entry) => [
      when(entry.at),
      entry.actor,
      joined(
        [
          entry.statusTo
            ? entry.statusFrom
              ? t("statusChange", {
                  from: domain(`shipmentStatus.${entry.statusFrom}`),
                  to: domain(`shipmentStatus.${entry.statusTo}`),
                })
              : domain(`shipmentStatus.${entry.statusTo}`)
            : null,
          entry.fields.length ? t("changed", { fields: entry.fields.join(", ") }) : null,
          entry.reason,
        ],
        t("recorded")
      ),
    ])
  );

  const sections: PdfSection[] = [
    { title: t("sections.details"), blocks: [{ kind: "fields", fields: details }] },
    {
      title: t("sections.lines"),
      blocks: [...lines, ...(figures.length ? [{ kind: "figures" as const, figures }] : [])],
    },
    { title: t("sections.history"), blocks: history },
    {
      title: t("sections.signatures"),
      blocks: [
        {
          kind: "fields",
          fields: [
            { label: t("signatures.released"), value: " " },
            { label: t("signatures.releasedDate"), value: " " },
            { label: t("signatures.received"), value: " " },
            { label: t("signatures.receivedDate"), value: " " },
          ],
        },
        { kind: "text", text: t("signatures.note"), muted: true },
      ],
    },
  ];

  return {
    record: ctx.record({
      title: t("title"),
      subject: shipment.reference,
      subtitle: joined(
        [domain(`shipmentDirection.${shipment.direction}`), shipment.organization.name],
        ""
      ),
      qrUrl: `${env().APP_URL.replace(/\/$/, "")}/inventory/materials/${shipment.id}`,
      sections,
    }),
    filename: ctx.filename("chain-of-custody", shipment.reference),
  };
}
