export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AddCapaButton, CapaStepButton } from "@/components/CapaDialogs";
import { IncidentSopForm } from "@/components/IncidentSopForm";
import { UpdateIncidentButton } from "@/components/QaDialogs";
import { EntityLink } from "@/components/page/EntityLink";
import { SeverityBadge } from "@/components/page/domain-badges";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { getIncidentDetail } from "@/features/qa/queries";
import { sopsEnabled } from "@/features/sop/enabled";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";
import { zonedDateKey } from "@/lib/lab-time";
import { positiveIntParam } from "@/lib/list-params";
import { env } from "@/server/env";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qa.capa");
  return { title: t("pageTitle") };
}

const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  await resolveRequestLocale(params);
  const { id } = await params;
  const user = await requirePageUser();
  const incidentId = positiveIntParam(id);
  if (!incidentId) notFound();
  const incident = await getIncidentDetail(user, incidentId);
  if (!incident) notFound();
  const t = await getTranslations("qa.capa");
  const domain = await getTranslations("domain");
  const format = await getFormatter();
  const openActions = incident.capaActions.filter((capa) => capa.status === "OPEN").length;

  return (
    <div>
      <PageHeader
        breadcrumbs={<HubCrumbs tab="holds" current={incident.code} />}
        title={
          <>
            <span className="me-3 font-mono text-fg-secondary">{incident.code}</span>
            {incident.title}
          </>
        }
        description={t("opened", {
          name: incident.user.name,
          date: format.dateTime(incident.createdAt, "dateTime"),
        })}
        actions={
          incident.canManage ? (
            <UpdateIncidentButton
              id={incident.id}
              title={incident.title}
              status={incident.status}
              resolution={incident.resolution}
            />
          ) : undefined
        }
      />

      {openActions > 0 && incident.status !== "CLOSED" ? (
        <Banner tone="info" className="mb-6">
          {t("closeBlocked", { count: openActions })}
        </Banner>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel>
          <PanelHeader
            title={t("actionsTitle")}
            description={t("actionsDescription")}
            actions={
              incident.canManage && incident.status !== "CLOSED" ? (
                <AddCapaButton
                  incidentId={incident.id}
                  members={incident.members}
                  today={zonedDateKey(new Date(), env().LAB_TIMEZONE)}
                />
              ) : undefined
            }
          />
          <PanelBody>
            {incident.capaActions.length === 0 ? (
              <p className="text-sm text-fg-secondary">{t("none")}</p>
            ) : (
              <ol className="divide-y divide-border">
                {incident.capaActions.map((capa) => (
                  <li key={capa.id} className="space-y-2 py-4 text-sm first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-fg-secondary">{capa.code}</span>
                          <Badge tone={capa.kind === "CORRECTIVE" ? "accent" : "info"}>
                            {t(`kinds.${capa.kind}`)}
                          </Badge>
                          <Badge
                            tone={
                              capa.status === "VERIFIED"
                                ? "success"
                                : capa.status === "DONE"
                                  ? "info"
                                  : capa.overdue
                                    ? "danger"
                                    : "warning"
                            }
                          >
                            {capa.overdue ? t("overdue") : t(`statuses.${capa.status}`)}
                          </Badge>
                        </p>
                        <p className="font-medium wrap-break-word text-fg">{capa.description}</p>
                        <p className="text-fg-secondary">
                          {capa.owner ? t("owner") + " " + capa.owner.name : t("noOwner")}
                          {capa.due
                            ? ` · ${t("dueOn", { date: format.dateTime(dayDate(capa.due), "date") })}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {capa.canComplete ? (
                          <CapaStepButton
                            incidentId={incident.id}
                            capaId={capa.id}
                            step="complete"
                            description={capa.description}
                          />
                        ) : null}
                        {capa.canVerify ? (
                          <CapaStepButton
                            incidentId={incident.id}
                            capaId={capa.id}
                            step="verify"
                            description={capa.description}
                          />
                        ) : null}
                      </div>
                    </div>
                    {capa.completedAt ? (
                      <p className="rounded-md bg-sunken p-2 text-fg">
                        <span className="text-fg-secondary">
                          {t("doneBy", {
                            name: capa.completedBy?.name ?? "",
                            date: format.dateTime(capa.completedAt, "date"),
                          })}
                        </span>{" "}
                        {capa.completionNote}
                      </p>
                    ) : null}
                    {capa.verifiedAt ? (
                      <p className="rounded-md bg-success-soft p-2 text-fg">
                        <span className="text-fg-secondary">
                          {t("verifiedBy", {
                            name: capa.verifiedBy?.name ?? "",
                            date: format.dateTime(capa.verifiedAt, "date"),
                          })}
                        </span>{" "}
                        {capa.verificationNote}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title={t("facts")} />
          <PanelBody>
            <dl className="space-y-5 text-sm">
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("severity")}
                </dt>
                <dd className="mt-1.5">
                  <SeverityBadge severity={incident.severity} />
                </dd>
              </div>
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("status")}
                </dt>
                <dd className="mt-1.5 text-fg">{domain(`incidentStatus.${incident.status}`)}</dd>
              </div>
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("about")}
                </dt>
                <dd className="mt-1.5 text-fg">
                  {incident.unit ? (
                    <EntityLink kind="unit" id={incident.unit.id}>
                      {incident.unit.name}
                    </EntityLink>
                  ) : incident.experiment ? (
                    <EntityLink kind="experiment" id={incident.experiment.id}>
                      {incident.experiment.ecode}
                    </EntityLink>
                  ) : incident.cultivar ? (
                    <EntityLink kind="cultivar" id={incident.cultivar.id}>
                      {incident.cultivar.name}
                    </EntityLink>
                  ) : (
                    domain("empty")
                  )}
                </dd>
              </div>
              {sopsEnabled() ? (
                <div>
                  <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                    {t("sop")}
                  </dt>
                  <dd className="mt-1.5 text-fg">
                    {incident.canManage ? (
                      <IncidentSopForm
                        incidentId={incident.id}
                        sopId={incident.sop?.id ?? null}
                        sops={incident.sops}
                      />
                    ) : incident.sop ? (
                      <Link
                        href={`/quality/sops/${incident.sop.id}`}
                        className="text-accent-text hover:underline"
                      >
                        {incident.sop.code} · {incident.sop.title}
                      </Link>
                    ) : (
                      t("sopNone")
                    )}
                  </dd>
                  {incident.canManage && incident.sop ? (
                    <Link
                      href={`/quality/sops/${incident.sop.id}`}
                      className="mt-1 inline-block text-xs text-accent-text hover:underline"
                    >
                      {t("sopOpen", { code: incident.sop.code })}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("what")}
                </dt>
                <dd className="whitespace-pre-wrap text-fg">{incident.description}</dd>
              </div>
              {incident.resolution ? (
                <div>
                  <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                    {t("resolution")}
                  </dt>
                  <dd className="whitespace-pre-wrap text-fg">{incident.resolution}</dd>
                </div>
              ) : null}
            </dl>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
