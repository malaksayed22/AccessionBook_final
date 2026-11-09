export const dynamic = "force-dynamic";

import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LabSettingsForm } from "@/components/LabSettingsForm";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { LockedState } from "@/components/ui/LockedState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { resolveRequestLocale } from "@/i18n/locale";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { getLabSettings } from "@/server/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("pageTitle") };
}

/** The laboratory's settings: licence details, how far back events may be dated, the code prefix. */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("settings");
  if (!isAdmin(user)) {
    return (
      <LockedState
        icon={<Lock />}
        title={t("lockedTitle")}
        body={t("lockedBody")}
        action={{ label: t("lockedAction"), href: "/dashboard" }}
      />
    );
  }
  const settings = await getLabSettings();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="settings" />}
        title={t("title")}
        description={t("description")}
      />
      <Panel className="overflow-hidden before:hidden">
        <PanelBody className="p-0 sm:p-0">
          <LabSettingsForm settings={settings} />
        </PanelBody>
      </Panel>
    </div>
  );
}
