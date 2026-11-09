export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PrintAuditButton } from "@/components/PrintAuditButton";
import { EntityLink } from "@/components/page/EntityLink";
import {
  getUnitDocuments,
  getUnitLedger,
  getUnitProfile,
  getUnitQuality,
  getUnitStates,
} from "@/features/unit/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { positiveIntParam } from "@/lib/list-params";
import { requirePageUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("units.export");
  return { title: t("pageTitle") };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid-page">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Table({
  caption,
  head,
  children,
}: {
  caption: string;
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-strong print:border-black">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1 pe-2 align-bottom font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border align-top print:border-gray-300">{children}</tr>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="py-1 pe-2 wrap-break-word">{children}</td>;
}

/** Printable audit report for one unit: every recorded event, hold, result and document, with who and when. */
export default async function UnitExportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const { id } = await params;
  // A positive id that fits the database column; anything else is a 404, never a database error.
  const unitId = positiveIntParam(id);
  if (!unitId) notFound();

  const profile = await getUnitProfile(user, unitId);
  if (!profile) notFound();
  const [states, quality, documents, ledger] = await Promise.all([
    getUnitStates(user, unitId),
    getUnitQuality(user, unitId),
    getUnitDocuments(user, unitId),
    getUnitLedger(user, unitId),
  ]);

  const t = await getTranslations("units.export");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const empty = domain("empty");
  const when = (d: Date) => format.dateTime(d, "dateTime");
  const grams = (n: number | null) => (n === null ? empty : format.number(n, "grams"));
  const changes = ledger.filter((e) => e.type === "AUDIT" || e.type === "LINEAGE_LINKED");

  // On paper a link is just text, so these links drop their colour and underline when printed.
  const printPlain = "print:text-black print:no-underline";
  const summary: Array<[string, ReactNode]> = [
    [t("fields.id"), String(profile.id)],
    [t("fields.type"), domain(`unitType.${profile.type}`)],
    [t("fields.status"), domain(`unitStatus.${profile.status}`)],
    [
      t("fields.cultivar"),
      <EntityLink key="cultivar" kind="cultivar" id={profile.cultivar?.id} className={printPlain}>
        {profile.cultivar?.name ?? empty}
      </EntityLink>,
    ],
    [
      t("fields.experiment"),
      <EntityLink
        key="experiment"
        kind="experiment"
        id={profile.experiment?.id}
        className={printPlain}
      >
        {profile.experiment ? `${profile.experiment.ecode} · ${profile.experiment.name}` : empty}
      </EntityLink>,
    ],
    [
      t("fields.location"),
      <EntityLink
        key="location"
        kind="location"
        id={profile.current?.locationId}
        className={printPlain}
      >
        {profile.current?.locationName ?? empty}
      </EntityLink>,
    ],
    [
      t("fields.stage"),
      profile.current?.growthStage ? domain(`growthStage.${profile.current.growthStage}`) : empty,
    ],
    [t("fields.humidWeight"), grams(profile.weights.humid)],
    [t("fields.dryWeight"), grams(profile.weights.dry)],
    [
      t("fields.seedCount"),
      profile.current?.seedCount != null
        ? format.number(profile.current.seedCount, "count")
        : empty,
    ],
    [
      t("fields.source"),
      [
        profile.source.type ? domain(`sourceType.${profile.source.type}`) : null,
        profile.source.provider?.name,
      ]
        .filter(Boolean)
        .join(" · ") || empty,
    ],
    [t("fields.registered"), when(profile.createdAt)],
  ];

  return (
    <div className="audit-export mx-auto max-w-4xl rounded-xl border border-border bg-surface p-8 text-fg print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
      <PrintAuditButton />

      <header className="border-b border-border pb-4 print:border-black">
        <p className="text-sm text-fg-secondary print:text-black">
          {t("product", { brand: BRAND.name })}
        </p>
        <h1 className="mt-2 text-3xl font-bold">{profile.name}</h1>
        <p className="text-sm">{t("generated", { when: when(new Date()), by: user.name })}</p>
        <p className="text-sm text-fg-secondary print:text-black">{t("immutable")}</p>
      </header>

      <Section title={t("summary")}>
        <Table caption={t("summary")} head={[t("field"), t("value")]}>
          {summary.map(([label, value]) => (
            <Row key={label}>
              <Cell>{label}</Cell>
              <Cell>{value}</Cell>
            </Row>
          ))}
        </Table>
        {profile.notes ? (
          <p className="mt-2 text-sm whitespace-pre-wrap">
            <strong>{t("notes")}</strong> {profile.notes}
          </p>
        ) : null}
      </Section>

      <Section title={t("lineage")}>
        <p className="text-sm">
          <strong>{t("parent")}</strong> {profile.parent?.name ?? empty}
        </p>
        <p className="text-sm">
          <strong>{t("children")}</strong> {profile.children.map((c) => c.name).join(", ") || empty}
          {profile.childCount > profile.children.length
            ? ` ${t("andMore", { count: profile.childCount - profile.children.length })}`
            : ""}
        </p>
      </Section>

      <Section title={t("events")}>
        <Table
          caption={t("events")}
          head={[
            t("columns.number"),
            t("columns.effective"),
            t("columns.recorded"),
            t("columns.by"),
            t("columns.event"),
            t("columns.state"),
            t("columns.details"),
          ]}
        >
          {states.map((s) => (
            <Row key={s.id}>
              <Cell>{s.sequence}</Cell>
              <Cell>{when(s.effectiveAt)}</Cell>
              <Cell>{when(s.recordedAt)}</Cell>
              <Cell>{s.recordedBy}</Cell>
              <Cell>
                {domain(`stateKind.${s.kind}`)}
                {s.scanConfirmed ? ` (${t("scanned")})` : ""}
              </Cell>
              <Cell>
                {[
                  s.locationName,
                  s.growthStage ? domain(`growthStage.${s.growthStage}`) : null,
                  s.humidWeight !== null ? `${t("wet")} ${grams(s.humidWeight)}` : null,
                  s.dryWeight !== null ? `${t("dry")} ${grams(s.dryWeight)}` : null,
                  s.seedCount !== null ? t("seeds", { count: s.seedCount }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || empty}
              </Cell>
              <Cell>
                {[
                  s.organizationName,
                  s.reason ? `${t("reason")} ${s.reason}` : null,
                  s.witnessName ? `${t("witness")} ${s.witnessName}` : null,
                  s.comment,
                ]
                  .filter(Boolean)
                  .join(" · ") || empty}
              </Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <Section title={t("holds")}>
        {quality.holds.length === 0 ? (
          <p className="text-sm">{t("none")}</p>
        ) : (
          <Table
            caption={t("holds")}
            head={[
              t("columns.kind"),
              t("columns.placed"),
              t("columns.reason"),
              t("columns.released"),
            ]}
          >
            {quality.holds.map((h) => (
              <Row key={h.id}>
                <Cell>
                  {domain(`holdKind.${h.kind}`)} · {domain(`holdOrigin.${h.origin}`)}
                </Cell>
                <Cell>
                  {when(h.placedAt)} · {h.placedBy}
                </Cell>
                <Cell>{h.reason}</Cell>
                <Cell>
                  {h.releasedAt
                    ? `${when(h.releasedAt)} · ${h.releasedBy ?? empty}${h.releaseNote ? ` · ${h.releaseNote}` : ""}`
                    : t("stillActive")}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      {LAB_RESULTS_SHOWN ? (
        <Section title={t("tests")}>
          {quality.tests.length === 0 ? (
            <p className="text-sm">{t("none")}</p>
          ) : (
            <Table
              caption={t("tests")}
              head={[
                t("columns.tested"),
                t("columns.test"),
                t("columns.result"),
                t("columns.lab"),
                t("columns.by"),
              ]}
            >
              {quality.tests.map((x) => (
                <Row key={x.id}>
                  <Cell>{when(x.testedAt)}</Cell>
                  <Cell>
                    {domain(`testPanel.${x.panel}`)}
                    {x.analyte ? ` · ${x.analyte}` : ""}
                  </Cell>
                  <Cell>
                    {[
                      x.value !== null
                        ? `${format.number(x.value)}${x.uom ? ` ${x.uom}` : ""}`
                        : null,
                      x.wetWeight !== null
                        ? t("wetWeight", { value: format.number(x.wetWeight, "grams") })
                        : null,
                      x.dryWeight !== null
                        ? t("dryWeight", { value: format.number(x.dryWeight, "grams") })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || t("noNumber")}
                  </Cell>
                  <Cell>{x.labName ?? empty}</Cell>
                  <Cell>{x.recordedBy}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Section>
      ) : null}

      <Section title={t("incidents")}>
        {quality.incidents.length === 0 ? (
          <p className="text-sm">{t("none")}</p>
        ) : (
          <Table
            caption={t("incidents")}
            head={[
              t("columns.opened"),
              t("columns.severity"),
              t("columns.incident"),
              t("columns.status"),
            ]}
          >
            {quality.incidents.map((i) => (
              <Row key={i.id}>
                <Cell>
                  {when(i.openedAt)} · {i.openedBy}
                </Cell>
                <Cell>{domain(`incidentSeverity.${i.severity}`)}</Cell>
                <Cell>
                  {i.title}: {i.description}
                  {i.resolution ? ` — ${i.resolution}` : ""}
                </Cell>
                <Cell>{domain(`incidentStatus.${i.status}`)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t("activities")}>
        {documents.activities.length === 0 ? (
          <p className="text-sm">{t("none")}</p>
        ) : (
          <Table
            caption={t("activities")}
            head={[t("columns.when"), t("columns.by"), t("columns.type"), t("columns.details")]}
          >
            {documents.activities.map((a) => (
              <Row key={a.id}>
                <Cell>{when(a.date)}</Cell>
                <Cell>{a.recordedBy}</Cell>
                <Cell>{domain(`activityType.${a.type}`)}</Cell>
                <Cell>
                  {[
                    a.title,
                    a.product,
                    a.pcpNumber ? t("pcp", { number: a.pcpNumber }) : null,
                    a.amount !== null
                      ? `${format.number(a.amount)} ${a.amountUnit ?? ""}`.trim()
                      : null,
                    a.method,
                    a.details,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t("documents")}>
        {documents.attachments.length === 0 ? (
          <p className="text-sm">{t("none")}</p>
        ) : (
          <Table
            caption={t("documents")}
            head={[
              t("columns.document"),
              t("columns.category"),
              t("columns.added"),
              t("columns.checksum"),
            ]}
          >
            {documents.attachments.map((a) => (
              <Row key={a.id}>
                <Cell>
                  {a.label} ({a.fileName})
                </Cell>
                <Cell>{domain(`attachmentCategory.${a.category}`)}</Cell>
                <Cell>
                  {when(a.uploadedAt)} · {a.uploadedBy}
                </Cell>
                <Cell>
                  <code className="text-xs break-all">{a.sha256 ?? empty}</code>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t("otherChanges")}>
        {changes.length === 0 ? (
          <p className="text-sm">{t("none")}</p>
        ) : (
          <Table
            caption={t("otherChanges")}
            head={[t("columns.when"), t("columns.by"), t("columns.details")]}
          >
            {changes.map((c) => (
              <Row key={c.key}>
                <Cell>{when(new Date(c.at))}</Cell>
                <Cell>{c.actor ?? empty}</Cell>
                <Cell>
                  {c.type === "LINEAGE_LINKED"
                    ? t("linkedParent", { parent: String(c.facts.parent ?? empty) })
                    : (c.note ?? empty)}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      {profile.destruction ? (
        <Section title={t("destruction")}>
          <p className="text-sm">
            {t("destroyedOn", {
              when: when(profile.destruction.at),
              by: profile.destruction.recordedBy ?? empty,
            })}
          </p>
          <p className="text-sm">
            <strong>{t("reason")}</strong> {profile.destruction.reason ?? empty}
          </p>
          {profile.destruction.witness ? (
            <p className="text-sm">
              <strong>{t("witness")}</strong> {profile.destruction.witness}
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
