import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";
import type { SessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { zonedDateKey } from "@/lib/lab-time";
import {
  renderRecordPdf,
  type PdfBlock,
  type PdfColumn,
  type PdfRecord,
  type PdfSection,
} from "@/lib/pdf/record-pdf";
import { env } from "@/server/env";
import { getLabSettings } from "@/server/settings";

/**
 * What the unit and experiment records share: the reader's language and clock, the title block's
 * lines, the page footer, and the way an empty list reads. Records are read-only views of what the
 * audit trail holds; building one changes nothing.
 */
export type RecordFile = { record: PdfRecord; filename: string };

/** The most rows one table of a record lists; the rest are counted under it. */
export const RECORD_ROW_LIMIT = 1000;

/** The language a record is asked for (`?locale=fr`); English otherwise. */
export function recordLocale(request: Request): AppLocale {
  const requested = new URL(request.url).searchParams.get("locale");
  return routing.locales.find((locale) => locale === requested) ?? routing.defaultLocale;
}

/** The record as a PDF download. Never cached: it holds regulated data. */
export async function recordResponse(file: RecordFile): Promise<Response> {
  const bytes = await renderRecordPdf(file.record);
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

export async function recordContext(locale: AppLocale, user: SessionUser) {
  const t = await getTranslations({ locale, namespace: "recordPdf.common" });
  const domain = await getTranslations({ locale, namespace: "domain" });
  const format = await getFormatter({ locale });
  const generatedAt = new Date();
  const settings = await getLabSettings();
  const empty = domain("empty");

  const when = (date: Date) => format.dateTime(date, "dateTime");
  const day = (date: Date) => format.dateTime(date, "date");
  const grams = (value: number | null) => (value === null ? empty : format.number(value, "grams"));
  const count = (value: number | null) => (value === null ? empty : format.number(value, "count"));
  const number = (value: number) => format.number(value);
  const percent = (value: number) => format.number(value, "percent");

  /** An activity's title, product, PCP registration number, amount, method and notes. */
  const activityText = (activity: {
    title: string;
    details: string | null;
    product: string | null;
    pcpNumber: string | null;
    amount: number | null;
    amountUnit: string | null;
    method: string | null;
  }) =>
    joined(
      [
        activity.title,
        activity.product,
        activity.pcpNumber ? t("pcp", { number: activity.pcpNumber }) : null,
        activity.amount !== null
          ? `${format.number(activity.amount)} ${activity.amountUnit ?? ""}`.trim()
          : null,
        activity.method,
        activity.details,
      ],
      empty
    );

  /** A table, or "None recorded." when there are no rows; rows past the limit are counted. */
  const table = (
    columns: readonly PdfColumn[],
    rows: ReadonlyArray<readonly string[]>,
    options: { total?: readonly string[]; more?: number } = {}
  ): PdfBlock[] => {
    if (rows.length === 0) return [{ kind: "text", text: t("none"), muted: true }];
    const more = options.more ?? 0;
    return [
      { kind: "table", columns, rows, total: options.total },
      ...(more > 0
        ? [{ kind: "text" as const, text: t("more", { count: more }), muted: true }]
        : []),
    ];
  };

  const record = (input: {
    title: string;
    subject: string;
    subtitle?: string;
    qrUrl: string;
    sections: PdfSection[];
  }): PdfRecord => {
    const licence = settings.licenceNumber;
    return {
      language: locale,
      brand: BRAND.name,
      title: input.title,
      subject: input.subject,
      subtitle: input.subtitle,
      meta: [
        t("generated", { when: when(generatedAt), name: user.name }),
        licence ? t("licence", { licence }) : t("noLicence"),
        t("fromTrail"),
      ],
      qr: { url: input.qrUrl, caption: t("qr") },
      footer: `${BRAND.name} · ${input.title} · ${input.subject} · ${day(generatedAt)}`,
      pageNumber: (page, total) => t("page", { page, total }),
      author: user.name,
      generatedAt,
      sections: input.sections,
    };
  };

  /** `unit-record-EXP1-002-P01-2026-11-02.pdf`: plain characters only, safe in any header. */
  const filename = (kind: string, name: string) => {
    const safe = name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "record";
    return `${kind}-${safe}-${zonedDateKey(generatedAt, env().LAB_TIMEZONE)}.pdf`;
  };

  return {
    t,
    domain,
    empty,
    when,
    day,
    grams,
    count,
    number,
    percent,
    activityText,
    table,
    record,
    filename,
    generatedAt,
  };
}

export type RecordContext = Awaited<ReturnType<typeof recordContext>>;

/** Joins the parts that are set with " · ", or the empty mark. */
export function joined(parts: ReadonlyArray<string | null | undefined | false>, empty: string) {
  return parts.filter(Boolean).join(" · ") || empty;
}
