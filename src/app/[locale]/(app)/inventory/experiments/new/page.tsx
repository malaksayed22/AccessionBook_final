export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewExperimentWizard } from "@/components/experiment/wizard/NewExperimentWizard";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { recordIdParam } from "@/features/experiment/ids";
import { getExperimentWizardOptions } from "@/features/experiment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("experiments.wizard");
  return { title: t("pageTitle") };
}

/**
 * `?parent=<experiment id>` starts a sub-experiment; `?unit=<unit id>` pre-fills the starting
 * material from that unit. Both are untrusted: the query validates them and the service checks
 * permission again on creation.
 */
export default async function NewExperimentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("experiments.wizard");
  const options = await getExperimentWizardOptions(user, {
    parentId: recordIdParam(raw.parent),
    sourceUnitId: recordIdParam(raw.unit),
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="experiments" kind="new" />}
        title={t("title")}
        description={t("description")}
      />
      <NewExperimentWizard options={options} />
    </div>
  );
}
