export const dynamic = "force-dynamic";

import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OrganizationForm } from "@/components/OrganizationForm";
import { LockedState } from "@/components/ui/LockedState";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { resolveRequestLocale } from "@/i18n/locale";
import { isAdmin, requirePageUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("organizations.new");
  return { title: t("pageTitle") };
}

export default async function NewOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("organizations.new");

  if (!isAdmin(user)) {
    return (
      <LockedState
        icon={<Lock />}
        title={t("lockedTitle")}
        body={t("lockedBody")}
        action={{ label: t("lockedAction"), href: "/records/organizations" }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="organizations" kind="new" />}
        title={t("title")}
        description={t("description")}
      />
      <Panel>
        <PanelBody>
          <OrganizationForm mode="create" />
        </PanelBody>
      </Panel>
    </div>
  );
}
