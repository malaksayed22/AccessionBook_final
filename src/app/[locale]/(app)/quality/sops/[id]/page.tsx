export const dynamic = "force-dynamic";

import { CheckCircle2, CircleDashed, FileDown } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { formatFileSize } from "@/components/experiment/document-upload";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { SopActions } from "@/components/sop/SopDialogs";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { sopsEnabled } from "@/features/sop/enabled";
import { getSop } from "@/features/sop/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";
import { positiveIntParam } from "@/lib/list-params";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sops");
  return { title: t("pageTitle") };
}

export default async function SopPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  if (!sopsEnabled()) notFound();
  await resolveRequestLocale(params);
  const { id } = await params;
  const user = await requirePageUser();
  const sopId = positiveIntParam(id);
  if (!sopId) notFound();
  const sop = await getSop(user, sopId);
  if (!sop) notFound();
  const t = await getTranslations("sops.detail");
  const statusLabel = await getTranslations("sops.status");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const shown = sop.effective ?? sop.draft;
  const signedCount = sop.roster.filter((member) => member.signedAt).length;

  return (
    <div>
      <PageHeader
        breadcrumbs={<HubCrumbs tab="sops" current={sop.code} />}
        title={`${sop.code} · ${sop.title}`}
        description={
          sop.effective
            ? t("inEffect", {
                version: sop.effective.version,
                date: format.dateTime(sop.effective.approvedAt!, "date"),
                name: sop.effective.approvedBy?.name ?? "",
              })
            : t("notInEffect")
        }
        actions={
          <SopActions
            sop={{
              id: sop.id,
              code: sop.code,
              baseBody: (sop.draft ?? sop.effective)?.body ?? "",
              draft: sop.draft
                ? { version: sop.draft.version, changeNote: sop.draft.changeNote }
                : null,
              effectiveVersion: sop.effective?.version ?? null,
              canWrite: sop.canWrite,
              canSign: sop.canSign,
              signed: sop.mySignature !== null,
            }}
          />
        }
      />

      {sop.canSign && sop.mySignature === null ? (
        <Banner tone="warning" className="mb-6">
          {t("toSign", { version: sop.effective!.version })}
        </Banner>
      ) : sop.mySignature ? (
        <Banner tone="success" className="mb-6">
          {t("youSigned", {
            version: sop.effective!.version,
            date: format.dateTime(sop.mySignature, "dateTime"),
          })}
        </Banner>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel>
          <PanelHeader
            title={
              shown
                ? t(shown === sop.effective ? "procedure" : "draftProcedure", {
                    version: shown.version,
                  })
                : t("procedureNone")
            }
            description={shown?.changeNote ?? undefined}
          />
          <PanelBody className="space-y-4">
            {shown?.fileName ? (
              // A file from an API route: a plain link, with no language prefix.
              <a
                href={`/api/sops/${sop.id}/versions/${shown.version}/file`}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-sunken px-3 py-2 text-sm font-medium text-accent-text hover:underline"
              >
                <FileDown aria-hidden="true" className="size-4" />
                {t("document", {
                  name: shown.fileName,
                  size: formatFileSize(shown.fileSize ?? 0),
                })}
              </a>
            ) : null}
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-fg">{shown?.body}</div>
          </PanelBody>
        </Panel>

        <div className="min-w-0 space-y-6">
          {sop.effective ? (
            <Panel>
              <PanelHeader
                title={t("roster")}
                description={t("rosterCount", {
                  signed: signedCount,
                  staff: sop.roster.length,
                  version: sop.effective.version,
                })}
              />
              <PanelBody>
                <ul className="divide-y divide-border text-sm">
                  {sop.roster.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex items-center gap-2">
                        {member.signedAt ? (
                          <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                        ) : (
                          <CircleDashed aria-hidden="true" className="size-4 text-fg-tertiary" />
                        )}
                        {member.name}
                      </span>
                      <span className={member.signedAt ? "text-fg-secondary" : "text-danger"}>
                        {member.signedAt
                          ? format.dateTime(member.signedAt, "date")
                          : t("notSigned")}
                      </span>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title={t("deviations")} description={t("deviationsHint")} />
            <PanelBody>
              {sop.deviations.length === 0 ? (
                <p className="text-sm text-fg-secondary">{t("noDeviations")}</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {sop.deviations.map((incident) => (
                    <li key={incident.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
                      <Link
                        href={`/quality/incidents/${incident.id}`}
                        className="font-medium text-accent-text hover:underline"
                      >
                        {incident.title}
                      </Link>
                      <p className="text-xs text-fg-secondary">
                        {domain(`incidentSeverity.${incident.severity}`)} ·{" "}
                        {domain(`incidentStatus.${incident.status}`)} ·{" "}
                        {format.dateTime(incident.createdAt, "date")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title={t("history")} />
            <PanelBody>
              <ol className="divide-y divide-border text-sm">
                {sop.versions.map((version) => (
                  <li key={version.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="flex items-center justify-between gap-2 font-medium text-fg">
                      {t("version", { version: version.version })}
                      <Badge
                        tone={
                          version.status === "EFFECTIVE"
                            ? "success"
                            : version.status === "DRAFT"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {statusLabel(version.status)}
                      </Badge>
                    </p>
                    {version.changeNote ? (
                      <p className="text-fg-secondary">{version.changeNote}</p>
                    ) : null}
                    {version.fileName ? (
                      <a
                        href={`/api/sops/${sop.id}/versions/${version.version}/file`}
                        className="text-xs text-accent-text hover:underline"
                      >
                        {version.fileName}
                      </a>
                    ) : null}
                    <p className="text-xs text-fg-secondary">
                      {version.approvedAt
                        ? t("approvedBy", {
                            name: version.approvedBy?.name ?? "",
                            date: format.dateTime(version.approvedAt, "date"),
                          })
                        : t("draftedBy", {
                            name: version.createdBy.name,
                            date: format.dateTime(version.createdAt, "date"),
                          })}
                      {version.approvedAt
                        ? ` · ${t("signatures", { count: version._count.signoffs })}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
