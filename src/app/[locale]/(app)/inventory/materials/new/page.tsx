export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ShipmentForm } from "@/components/ShipmentForm";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { getShipmentFormOptions, getShippableUnit } from "@/features/shipment/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { positiveIntParam } from "@/lib/list-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("materials.form");
  return { title: t("pageTitle") };
}

export default async function NewMaterialMovementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("materials.form");

  if (!isAdmin(user)) {
    return (
      <div>
        <PageHeader
          breadcrumbs={<HubCrumbs tab="materials" kind="new" />}
          title={t("title")}
          description={t("description")}
        />
        <EmptyState
          title={t("lockedTitle")}
          description={t("lockedBody")}
          action={
            <Button href="/inventory/materials" variant="secondary">
              {t("lockedAction")}
            </Button>
          }
        />
      </div>
    );
  }

  // "Ship" on a unit's page opens this form as an outbound shipment with that unit as its first line.
  const unitId = positiveIntParam((await searchParams).unit);
  const [options, initialUnit] = await Promise.all([
    getShipmentFormOptions(),
    unitId ? getShippableUnit(user, unitId) : Promise.resolve(null),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="materials" kind="new" />}
        title={t("title")}
        description={t("description")}
      />
      <ShipmentForm
        organizations={options.organizations}
        cultivars={options.cultivars}
        initialUnit={initialUnit ?? undefined}
      />
    </div>
  );
}
