import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import type { AppLocale } from "@/i18n/routing";
import type { SessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { zonedDateKey } from "@/lib/lab-time";
import { LABEL_TEMPLATES, labelsPerPage } from "@/lib/labels/templates";
import { renderLabelPdf, type LabelContent, type LabelDocument } from "@/lib/pdf/label-pdf";
import { getUnitBarcodeValue, getUnitProfileUrl } from "@/lib/unit-codes";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";
import { experimentReadScope, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { getShipmentDetail } from "@/features/shipment/queries";
import type { LabelRequest } from "./schemas";
import type { TissueKind } from "@/features/unit/schemas";

/**
 * The labels asked for, as a document ready to render, or null when the record does not exist or
 * the member may not read it. Printing labels changes nothing, so nothing is audited.
 */
export type LabelFile = { document: LabelDocument; filename: string };

/** The most labels one file holds: an experiment's units, or every location. */
export const MAX_LABELS = 500;

export async function buildLabels(
  user: SessionUser,
  request: LabelRequest,
  locale: AppLocale
): Promise<LabelFile | null> {
  const t = await getTranslations({ locale, namespace: "recordPdf.labels" });
  const domain = await getTranslations({ locale, namespace: "domain" });
  const format = await getFormatter({ locale });
  const base = env().APP_URL.replace(/\/$/, "");
  const generatedAt = new Date();
  const copies = Math.min(request.copies, labelsPerPage(LABEL_TEMPLATES[request.template]));

  const unitLabel = (unit: UnitRow): LabelContent => ({
    title: unit.name,
    lines: [
      [domain(`unitType.${unit.type}`), unit.cultivar?.name].filter(Boolean).join(" · "),
      unit.sourceParentUnit && unit.sampleKind
        ? t("sampleOf", { name: unit.sourceParentUnit.name })
        : null,
      unit.experiment ? t("experiment", { code: unit.experiment.ecode }) : null,
      (unit.currentState?.plantCount ?? 1) > 1
        ? t("plants", { count: unit.currentState!.plantCount! })
        : null,
    ].filter((line): line is string => Boolean(line)),
    qr: getUnitProfileUrl(base, unit.id),
    barcode: getUnitBarcodeValue(unit.id, unit.name),
  });

  const file = (subject: string, labels: LabelContent[]): LabelFile => {
    const safe = subject.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "labels";
    return {
      document: {
        template: request.template,
        labels,
        skip: request.skip,
        title: t("title", { subject }),
        author: user.name,
        brand: BRAND.name,
        language: locale,
        generatedAt,
      },
      filename: `labels-${safe}-${request.template}-${zonedDateKey(generatedAt, env().LAB_TIMEZONE)}.pdf`,
    };
  };

  if (request.for === "unit") {
    const unit = await prisma.biologicalUnit.findFirst({
      where: { AND: [unitReadScope(user), { id: request.id }] },
      select: UNIT_SELECT,
    });
    if (!unit) return null;
    return file(unit.name, repeat(unitLabel(unit), copies));
  }

  if (request.for === "experiment") {
    const experiment = await prisma.experiment.findFirst({
      where: { AND: [experimentReadScope(user), { id: request.id }] },
      select: { id: true, ecode: true },
    });
    if (!experiment) return null;
    const units = await prisma.biologicalUnit.findMany({
      where: {
        AND: [
          unitReadScope(user),
          { experimentId: experiment.id },
          { currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: MAX_LABELS,
      select: UNIT_SELECT,
    });
    return file(experiment.ecode, units.map(unitLabel));
  }

  if (request.for === "tissue") {
    const sample = await prisma.tissueSample.findFirst({
      where: { id: request.id, unit: { is: unitReadScope(user) } },
      select: {
        code: true,
        purpose: true,
        tissue: true,
        takenAt: true,
        unit: { select: { id: true, name: true, experiment: { select: { ecode: true } } } },
      },
    });
    if (!sample) return null;
    const label: LabelContent = {
      title: sample.code,
      lines: [
        `${domain(`tissuePurpose.${sample.purpose}`)} · ${domain(`tissueKind.${sample.tissue as TissueKind}`)}`,
        t("tissueFrom", { name: sample.unit.name }),
        t("taken", { date: format.dateTime(sample.takenAt, "date") }),
        sample.unit.experiment ? t("experiment", { code: sample.unit.experiment.ecode }) : null,
      ].filter((line): line is string => Boolean(line)),
      qr: getUnitProfileUrl(base, sample.unit.id),
      barcode: sample.code,
    };
    return file(sample.code, repeat(label, copies));
  }

  if (request.for === "shipment") {
    const shipment = await getShipmentDetail(user, request.id);
    if (!shipment) return null;
    const licence = shipment.licenceNumber ?? shipment.organization.licenceNumber;
    const label: LabelContent = {
      title: shipment.reference,
      lines: [
        t(shipment.direction === "OUTBOUND" ? "to" : "from", { name: shipment.organization.name }),
        licence ? t("licence", { number: licence }) : null,
        shipment.shippedDate
          ? t("shipped", { date: format.dateTime(shipment.shippedDate, "date") })
          : null,
        t("lines", { count: shipment.items.length }),
        shipment.trackingNumber ? t("tracking", { number: shipment.trackingNumber }) : null,
      ].filter((line): line is string => Boolean(line)),
      qr: `${base}/inventory/materials/${shipment.id}`,
      barcode: shipment.reference,
    };
    return file(shipment.reference, repeat(label, copies));
  }

  const locations = await prisma.location.findMany({
    where: request.id === undefined ? { active: true } : { id: request.id },
    orderBy: { name: "asc" },
    take: MAX_LABELS,
    select: {
      id: true,
      name: true,
      kind: true,
      capacity: true,
      capacityMeasure: true,
      address: true,
      parent: { select: { name: true } },
    },
  });
  if (request.id !== undefined && locations.length === 0) return null;
  const labels = locations.map((location): LabelContent => ({
    title: location.name,
    lines: [
      [
        domain(`locationKind.${location.kind}`),
        location.parent ? t("inside", { name: location.parent.name }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      location.capacity === null
        ? null
        : location.capacityMeasure === "WEIGHT"
          ? t("holdsWeight", { kg: location.capacity / 1000 })
          : t(location.capacityMeasure === "PLANTS" ? "holdsPlants" : "holdsUnits", {
              count: location.capacity,
            }),
      location.address,
    ].filter((line): line is string => Boolean(line)),
    // The QR code opens what is stored there.
    qr: `${base}/inventory/units?location=${location.id}`,
  }));
  const subject = request.id === undefined ? t("allLocations") : locations[0]!.name;
  return file(subject, request.id === undefined ? labels : repeat(labels[0]!, copies));
}

const UNIT_SELECT = {
  id: true,
  name: true,
  type: true,
  sampleKind: true,
  cultivar: { select: { name: true } },
  experiment: { select: { ecode: true } },
  sourceParentUnit: { select: { name: true } },
  currentState: { select: { plantCount: true } },
} satisfies Prisma.BiologicalUnitSelect;

type UnitRow = Prisma.BiologicalUnitGetPayload<{ select: typeof UNIT_SELECT }>;

function repeat<T>(item: T, times: number): T[] {
  return Array.from({ length: Math.max(1, times) }, () => item);
}

/** The labels as a PDF download. Never cached: they name regulated material. */
export async function labelResponse(file: LabelFile): Promise<Response> {
  const bytes = await renderLabelPdf(file.document);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
