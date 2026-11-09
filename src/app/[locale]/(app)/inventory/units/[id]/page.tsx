export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { UnitProfileView } from "@/components/UnitProfileView";
import type { UnitTabId } from "@/components/unit/UnitTabs";
import {
  getUnitDocuments,
  getUnitLedger,
  getUnitName,
  getUnitProfile,
  getUnitQuality,
  listLocationOptions,
} from "@/features/unit/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { getSessionUser, requirePageUser } from "@/lib/auth";
import { pickParam, positiveIntParam } from "@/lib/list-params";
import { getUnitProfileUrl } from "@/lib/unit-codes";
import { env } from "@/server/env";

const TABS = [
  "overview",
  "history",
  "lineage",
  "quality",
  "documents",
] as const satisfies readonly UnitTabId[];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("units.detail");
  const numericId = positiveIntParam((await params).id);
  const user = await getSessionUser();
  const name = numericId && user ? await getUnitName(user, numericId) : null;
  return { title: name ?? t("pageTitle") };
}

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const { id } = await params;
  const raw = await searchParams;

  // A positive id that fits the database column; anything else is a 404, never a database error.
  const unitId = positiveIntParam(id);
  if (!unitId) notFound();

  const profile = await getUnitProfile(user, unitId);
  if (!profile) notFound();

  const canEdit = profile.access.canEdit && profile.terminal === null;
  const [ledger, quality, documents, locations] = await Promise.all([
    getUnitLedger(user, unitId),
    getUnitQuality(user, unitId),
    getUnitDocuments(user, unitId),
    canEdit ? listLocationOptions() : Promise.resolve([]),
  ]);

  return (
    <UnitProfileView
      profile={profile}
      ledger={ledger}
      quality={quality}
      documents={documents}
      locations={locations}
      profileUrl={getUnitProfileUrl(env().APP_URL, unitId)}
      tab={pickParam(raw.tab, TABS) ?? "overview"}
      breadcrumbs={<HubCrumbs tab="units" current={profile.name} />}
    />
  );
}
