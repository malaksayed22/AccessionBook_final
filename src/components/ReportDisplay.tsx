import { CircleCheck, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { StatCard } from "@/components/page/StatCard";
import { Banner } from "@/components/ui/Banner";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Link } from "@/i18n/navigation";
import { BRAND } from "@/lib/brand";
import { ADDITION_LINES, DISPLAY_LINE_IDS, type DisplayLineId } from "@/lib/reports/ctls-template";
import {
  isKpiId,
  isSectionId,
  isSectionWithDescription,
  resolveColumnKey,
  translateCell,
} from "@/lib/reports/display";
import type { CtlsFormClass, CtlsSection, ReportResult, ReportSection } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

type Cell = string | number | null;
type Row = { index: number; cells: Record<string, Cell> };

const PRINT_TABLE = "print:max-h-none print:overflow-visible";

/*
 * Usage (server component): <ReportDisplay result={result} zone="America/Toronto" period="March 2026" />
 * Shows a generated report on screen in the reader's language. The report itself (and its CSV)
 * keeps the stable English regulatory wording; this translates titles, column headings, key
 * figures and the few vocabulary words in cells by stable id, falling back to the generator's own
 * text for anything it does not know. Dates in cells stay ISO, as in the export. Tables have a
 * sticky header and print in full.
 */
export function ReportDisplay({
  result,
  zone,
  period,
}: {
  result: ReportResult;
  zone: string;
  /** The period in the reader's language; omitted for point-in-time reports. */
  period?: string;
}) {
  const t = useTranslations("reports.display");
  const format = useFormatter();
  const { meta } = result;

  return (
    <div className="report-output space-y-6">
      <Panel>
        <PanelBody>
          <p className="text-sm font-medium text-fg-secondary">
            {t("brandReport", { brand: BRAND.name })}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {period ? (
              <div>
                <dt className="text-fg-secondary">{t("period")}</dt>
                <dd className="font-medium text-fg">{period}</dd>
              </div>
            ) : null}
            {meta.licenseId ? (
              <div>
                <dt className="text-fg-secondary">{t("licence")}</dt>
                <dd className="font-medium text-fg">{meta.licenseId}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-fg-secondary">{t("generated")}</dt>
              <dd className="font-medium text-fg">
                <time dateTime={meta.generatedAt}>
                  {format.dateTime(new Date(meta.generatedAt), "dateTime")}
                </time>
              </dd>
            </div>
          </dl>
        </PanelBody>
      </Panel>

      {result.kpis && result.kpis.length > 0 ? (
        <section aria-labelledby="report-kpis" className="space-y-3">
          <h2 id="report-kpis" className="text-base font-semibold text-fg">
            {t("keyFigures")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {result.kpis.map((kpi) => (
              <StatCard
                key={kpi.id ?? kpi.label}
                label={isKpiId(kpi.id) ? t(`kpis.${kpi.id}`) : kpi.label}
                value={kpiValue(kpi, t, format.number)}
                tone={
                  kpi.id === "reconciled" ? (kpi.value === "Yes" ? "success" : "danger") : "default"
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {result.ctls ? <CtlsPanel ctls={result.ctls} zone={zone} /> : null}

      {result.sections.map((section) => (
        <SectionPanel key={section.id ?? section.title} section={section} />
      ))}
    </div>
  );
}

function kpiValue(
  kpi: NonNullable<ReportResult["kpis"]>[number],
  t: ReturnType<typeof useTranslations<"reports.display">>,
  number: (value: number, options: { maximumFractionDigits: number }) => string
): ReactNode {
  if (kpi.id === "reconciled") return kpi.value === "Yes" ? t("tokens.yes") : t("tokens.no");
  return typeof kpi.value === "number"
    ? number(kpi.value, { maximumFractionDigits: 3 })
    : kpi.value;
}

function SectionPanel({ section }: { section: ReportSection }) {
  const t = useTranslations("reports.display");
  const domain = useTranslations("domain");
  const format = useFormatter();

  const title = isSectionId(section.id) ? t(`sections.${section.id}`) : section.title;
  const description = isSectionWithDescription(section.id)
    ? t(`sectionDescriptions.${section.id}`)
    : section.description;

  const rows: Row[] = section.rows.map((cells, index) => ({ index, cells }));
  const empty = domain("empty");

  const render = (column: ReportSection["columns"][number], row: Row): ReactNode => {
    const value = row.cells[column.key] ?? null;
    if (value === null || value === "") return empty;
    const translation = translateCell(section.id, column.key, value);
    if (translation) {
      switch (translation.ns) {
        case "ctlsClass":
          return t(`ctls.classes.${translation.key}`);
        case "ctlsLine":
          return t(`ctls.lines.${translation.key}`);
        case "unitType":
          return domain(`unitType.${translation.key}`);
        case "growthStage":
          return domain(`growthStage.${translation.key}`);
        case "sourceType":
          return domain(`sourceType.${translation.key}`);
        case "experimentStatus":
          return domain(`experimentStatus.${translation.key}`);
        case "token":
          return t(`tokens.${translation.key}`);
      }
    }
    if (typeof value === "number") return format.number(value, { maximumFractionDigits: 3 });
    // A row names where its records live: `_href` for the unit, `_href:<column>` for any other column.
    const href = column.key === "unit" ? row.cells._href : row.cells[`_href:${column.key}`];
    if (typeof href === "string") {
      return (
        <Link href={href} className="font-medium text-accent-text hover:underline">
          {value}
        </Link>
      );
    }
    return value;
  };

  const columns: Array<Column<Row>> = section.columns.map((column) => {
    const key = resolveColumnKey(section.id, column.key);
    return {
      id: column.key,
      header: key ? t(`columns.${key}`) : column.label,
      align: column.align === "right" ? "end" : undefined,
      className: column.align === "right" ? "tabular-nums" : undefined,
      cell: (row: Row) => render(column, row),
    };
  });

  return (
    <Panel>
      <PanelHeader title={title} description={description} />
      <PanelBody>
        <DataTable
          caption={title}
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(row) => row.index}
          stickyHeader
          density="compact"
          className={PRINT_TABLE}
          empty={<span className="text-fg-secondary">{t("noRecords")}</span>}
        />
      </PanelBody>
    </Panel>
  );
}

type FormRow =
  | { kind: "group"; id: "additions" | "reductions" }
  | { kind: "line"; id: DisplayLineId }
  | { kind: "check" };

/** The form's lines in order, with the additions and reductions grouped under a heading each. */
const FORM_ROWS: FormRow[] = [
  { kind: "line", id: "opening" },
  { kind: "group", id: "additions" },
  ...ADDITION_LINES.map((id): FormRow => ({ kind: "line", id })),
  { kind: "group", id: "reductions" },
  ...DISPLAY_LINE_IDS.filter(
    (id) =>
      id !== "opening" && id !== "closing" && !(ADDITION_LINES as readonly string[]).includes(id)
  ).map((id): FormRow => ({ kind: "line", id })),
  { kind: "line", id: "closing" },
  { kind: "check" },
];

const NAMES_SHOWN = 10;

const rowKey = (row: FormRow) => (row.kind === "check" ? "check" : `${row.kind}-${row.id}`);

function CtlsPanel({ ctls, zone }: { ctls: CtlsSection; zone: string }) {
  const t = useTranslations("reports.display");
  const format = useFormatter();

  const quantity = (cls: CtlsFormClass, line: DisplayLineId) => {
    const value = cls.lines[line];
    if (value === undefined) {
      return (
        <span className="text-fg-tertiary" title={t("ctls.notOnForm")}>
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t("ctls.notOnForm")}</span>
        </span>
      );
    }
    const kilograms = cls.measure === "kg" || line === "dryingLoss";
    const text = format.number(value, {
      minimumFractionDigits: kilograms ? 4 : 0,
      maximumFractionDigits: kilograms ? 4 : 0,
    });
    return <span className={cn(value === 0 && "text-fg-tertiary")}>{text}</span>;
  };

  const columns: Array<Column<FormRow>> = [
    {
      id: "line",
      header: t("ctls.line"),
      rowHeader: true,
      cell: (row) => {
        if (row.kind === "group") {
          return <span className="font-semibold text-fg">{t(`ctls.${row.id}`)}</span>;
        }
        if (row.kind === "check") return <span className="text-fg">{t("ctls.reconcilesRow")}</span>;
        const total = row.id === "opening" || row.id === "closing";
        return (
          <span className={cn(total ? "font-semibold text-fg" : "ps-4")}>
            {t(`ctls.lines.${row.id}`)}
          </span>
        );
      },
    },
    ...ctls.classes.map((cls): Column<FormRow> => ({
      id: cls.id,
      header: `${t(`ctls.classes.${cls.id}`)} (${cls.measure})`,
      align: "end",
      className: "tabular-nums whitespace-nowrap",
      cell: (row) => {
        if (row.kind === "group") return null;
        if (row.kind === "check") {
          return cls.reconciles ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CircleCheck aria-hidden="true" className="size-4" />
              {t("tokens.yes")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-danger">
              <TriangleAlert aria-hidden="true" className="size-4" />
              {t("tokens.no")}
            </span>
          );
        }
        const total = row.id === "opening" || row.id === "closing";
        return <span className={cn(total && "font-semibold")}>{quantity(cls, row.id)}</span>;
      },
    })),
  ];

  const { issues, cultures } = ctls;
  // A long list names the first few and counts the rest; the table below has them all.
  const names = (list: string[]) =>
    format.list(
      list.length > NAMES_SHOWN
        ? [...list.slice(0, NAMES_SHOWN), t("ctls.more", { count: list.length - NAMES_SHOWN })]
        : list,
      { type: "conjunction" }
    );
  const checks = [
    issues.licenceIdMissing ? t("ctls.checks.licenceIdMissing") : null,
    issues.recipientUnclassified.length > 0
      ? t("ctls.checks.recipientUnclassified", { names: names(issues.recipientUnclassified) })
      : null,
    issues.countryMissing.length > 0
      ? t("ctls.checks.countryMissing", { names: names(issues.countryMissing) })
      : null,
    issues.unweighed.length > 0
      ? t("ctls.checks.unweighed", { names: names(issues.unweighed) })
      : null,
    issues.trimShipped.lines > 0
      ? t("ctls.checks.trimShipped", {
          count: issues.trimShipped.lines,
          grams: format.number(issues.trimShipped.grams, { maximumFractionDigits: 3 }),
        })
      : null,
  ].filter((check): check is string => check !== null);

  const notes = [
    t("ctls.notes.zone", { zone }),
    t("ctls.notes.classes"),
    t("ctls.notes.transformations"),
    t("ctls.notes.counterparties"),
    t("ctls.notes.remeasure"),
    t("ctls.notes.notRecorded"),
  ];

  return (
    <Panel>
      <PanelHeader title={t("ctls.heading")} description={t("ctls.flow")} />
      <PanelBody className="space-y-4">
        <Banner tone={ctls.reconciles ? "success" : "danger"}>
          {ctls.reconciles ? t("ctls.reconciled") : t("ctls.notReconciled")}
        </Banner>
        {checks.length > 0 ? (
          <Banner tone="warning" title={t("ctls.checksHeading")}>
            <ul className="list-disc space-y-1 ps-5">
              {checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </Banner>
        ) : null}
        <DataTable
          caption={t("ctls.caption")}
          captionHidden
          columns={columns}
          rows={FORM_ROWS}
          rowKey={rowKey}
          stickyHeader
          density="compact"
          className={PRINT_TABLE}
        />
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold text-fg">{t("ctls.cultures.heading")}</h3>
          <p className="text-fg-secondary">
            {t("ctls.cultures.body", {
              opening: cultures.opening,
              added: cultures.added,
              removed: cultures.removed,
              closing: cultures.closing,
            })}
          </p>
        </div>
        <p className="text-sm text-fg-secondary print:hidden">{t("ctls.filing")}</p>
        <div>
          <h3 className="text-sm font-semibold text-fg">{t("ctls.notesHeading")}</h3>
          <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-fg-secondary">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </PanelBody>
    </Panel>
  );
}
