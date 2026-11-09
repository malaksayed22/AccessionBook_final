import { getTranslations } from "next-intl/server";
import { getRecallTrace } from "@/features/qa/queries";
import { recallToCsv, type RecallCsvLabels } from "@/features/qa/recall-csv";
import { routing } from "@/i18n/routing";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

const RELATIONS = ["self", "ancestor", "descendant", "same-cultivar"] as const;
const STANDINGS = ["active", "on-hold", "destroyed"] as const;
const TYPES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;

export const GET = withApi({ auth: "user" }, async (ctx) => {
  const params = new URL(ctx.request.url).searchParams;
  const unitId = parseId(params.get("unitId"), "unit");
  const trace = await getRecallTrace(ctx.user, unitId);
  if (!trace) throw errors.notFound("Unit");

  if (params.get("format") !== "csv") return trace;

  const requested = params.get("locale");
  const locale =
    routing.locales.find((candidate) => candidate === requested) ?? routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "recall" });
  const domain = await getTranslations({ locale, namespace: "domain" });
  const labels: RecallCsvLabels = {
    columns: {
      relation: t("csv.columns.relation"),
      generation: t("csv.columns.generation"),
      unit: t("csv.columns.unit"),
      type: t("csv.columns.type"),
      cultivar: t("csv.columns.cultivar"),
      experiment: t("csv.columns.experiment"),
      status: t("csv.columns.status"),
      hold: t("csv.columns.hold"),
      holdReason: t("csv.columns.holdReason"),
      location: t("csv.columns.location"),
      shippedTo: t("csv.columns.shippedTo"),
      shipments: t("csv.columns.shipments"),
    },
    relation: Object.fromEntries(
      RELATIONS.map((key) => [key, t(`csv.relation.${key}`)])
    ) as RecallCsvLabels["relation"],
    standing: Object.fromEntries(
      STANDINGS.map((key) => [key, domain(`unitStatus.${key}`)])
    ) as RecallCsvLabels["standing"],
    type: Object.fromEntries(
      TYPES.map((key) => [key, domain(`unitType.${key}`)])
    ) as RecallCsvLabels["type"],
    holdKind: { HOLD: domain("holdKind.HOLD") },
  };

  const filename = `recall-${trace.origin.name.replace(/[^\w.-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`﻿${recallToCsv(trace, labels)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
