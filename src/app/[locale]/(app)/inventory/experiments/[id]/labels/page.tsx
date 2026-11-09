export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExperimentLabelSheet } from "@/components/experiment/ExperimentLabelSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { recordIdParam } from "@/features/experiment/ids";
import { getExperimentLabels } from "@/features/experiment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";
import { Tag } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("experiments.labels");
  return { title: t("pageTitle") };
}

export default async function ExperimentLabelsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  await resolveRequestLocale(params);
  const { id } = await params;
  const user = await requirePageUser();
  const experimentId = recordIdParam(id);
  if (!experimentId) notFound();
  const data = await getExperimentLabels(user, experimentId);
  if (!data) notFound();
  const t = await getTranslations("experiments.labels");

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <HubCrumbs
            tab="experiments"
            trail={[
              {
                label: data.experiment.ecode,
                href: `/inventory/experiments/${data.experiment.id}`,
              },
            ]}
            kind="labels"
          />
        }
        title={t("title", { code: data.experiment.ecode })}
        description={t("description", { name: data.experiment.name })}
        actions={
          <Button href={`/inventory/experiments/${data.experiment.id}`} variant="secondary">
            {t("back")}
          </Button>
        }
      />
      {data.units.length === 0 ? (
        <EmptyState icon={<Tag />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ExperimentLabelSheet
          experimentCode={data.experiment.ecode}
          units={data.units}
          omitted={data.omitted}
          baseUrl={data.baseUrl}
        />
      )}
    </div>
  );
}
