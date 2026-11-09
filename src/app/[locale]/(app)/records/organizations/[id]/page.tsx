export const dynamic = "force-dynamic";

import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";
import { CYCLE } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { OrganizationAddDocumentButton } from "@/components/OrganizationAddDocumentButton";
import { OrganizationEditButton } from "@/components/OrganizationEditButton";
import { OrganizationRelations } from "@/components/OrganizationRelations";
import { HubCrumbs } from "@/components/shell/HubCrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { getOrganizationDetail, ORGANIZATION_SECTION_SIZE } from "@/features/organization/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { isAdmin, requirePageUser } from "@/lib/auth";
import { buildListUrl, positiveIntParam } from "@/lib/list-params";
import { ActivityPanel } from "./_components/ActivityPanel";
import { DocumentsPanel } from "./_components/DocumentsPanel";
import { ProfilePanel } from "./_components/ProfilePanel";
import { ShipmentsPanel } from "./_components/ShipmentsPanel";
import { SuppliedUnitsPanel } from "./_components/SuppliedUnitsPanel";
import { TestsPanel } from "./_components/TestsPanel";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("organizations.detail");
  const { id } = await params;
  return { title: t("pageTitle", { id }) };
}

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const { id: rawId } = await params;
  const raw = await searchParams;
  const id = positiveIntParam(rawId);
  if (!id) notFound();

  const pages = {
    inbound: positiveIntParam(raw.inPage) ?? 1,
    outbound: positiveIntParam(raw.outPage) ?? 1,
    units: positiveIntParam(raw.unitsPage) ?? 1,
    tests: positiveIntParam(raw.testsPage) ?? 1,
  };
  const detail = await getOrganizationDetail(user, id, pages);
  if (!detail) notFound();

  const t = await getTranslations("organizations.detail");
  const format = await getFormatter();
  const { organization, counts } = detail;
  const domain = await getTranslations("domain");

  // Each table pages on its own parameter, so moving one never resets another.
  const path = `/records/organizations/${id}`;
  const state = {
    inPage: pages.inbound,
    outPage: pages.outbound,
    unitsPage: pages.units,
    testsPage: pages.tests,
  };
  const pageHref = (key: keyof typeof state) => (page: number) =>
    buildListUrl(path, state, { [key]: page });

  const subtitle = [
    organization.country,
    organization.licenceNumber ? t("licenceLine", { licence: organization.licenceNumber }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={<HubCrumbs tab="organizations" current={organization.name} />}
        title={
          <>
            <span className="me-3 font-mono text-fg-secondary">{organization.code}</span>
            {organization.name}
          </>
        }
        description={subtitle || t("noDetails")}
        actions={
          isAdmin(user) ? (
            <>
              <OrganizationAddDocumentButton
                organizationId={organization.id}
                organizationName={organization.name}
              />
              <OrganizationEditButton organization={organization} />
            </>
          ) : undefined
        }
        className="pb-0"
      />

      <OrganizationRelations relations={detail.relations} />

      <StatusDonut
        title={t("stats.chartTitle")}
        slices={detail.unitTypes.map(({ type, count }, index) => ({
          key: type,
          label: domain(`unitTypePlural.${type}`),
          value: count,
          gradient: CYCLE[index % CYCLE.length]!,
          href: "#org-units",
        }))}
        centerValue={format.number(
          detail.unitTypes.reduce((sum, row) => sum + row.count, 0),
          "count"
        )}
        centerLabel={t("stats.chartCenter")}
        empty={<p className="text-sm text-fg-secondary">{t("stats.noUnits")}</p>}
        footer={
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <Link
              href={buildListUrl("/inventory/materials", {
                organization: id,
                direction: "INBOUND",
              })}
              className="hover:text-accent-text hover:underline"
            >
              {t("stats.receivedLine", { count: counts.unitsReceived })}
            </Link>
            <Link
              href={buildListUrl("/inventory/materials", {
                organization: id,
                direction: "OUTBOUND",
              })}
              className="hover:text-accent-text hover:underline"
            >
              {t("stats.shippedLine", { count: counts.unitsShipped })}
            </Link>
            <Link
              href={buildListUrl("/inventory/materials", { organization: id })}
              className="hover:text-accent-text hover:underline"
            >
              {t("stats.shipmentsLine", { count: counts.shipments })}
            </Link>
          </p>
        }
      />

      <ProfilePanel
        address={organization.address}
        country={organization.country}
        licenceNumber={organization.licenceNumber}
        licenceClass={organization.licenceClass}
        comment={organization.comment}
      />

      <DocumentsPanel organizationId={organization.id} documents={detail.documents} />
      <ShipmentsPanel
        headingId="org-inbound"
        title={t("shipments.inboundTitle")}
        emptyTitle={t("shipments.inboundEmptyTitle")}
        emptyBody={t("shipments.inboundEmptyBody")}
        rows={detail.inbound.rows}
        total={detail.inbound.total}
        page={pages.inbound}
        pageSize={ORGANIZATION_SECTION_SIZE}
        buildHref={pageHref("inPage")}
      />
      <ShipmentsPanel
        headingId="org-outbound"
        title={t("shipments.outboundTitle")}
        emptyTitle={t("shipments.outboundEmptyTitle")}
        emptyBody={t("shipments.outboundEmptyBody")}
        rows={detail.outbound.rows}
        total={detail.outbound.total}
        page={pages.outbound}
        pageSize={ORGANIZATION_SECTION_SIZE}
        buildHref={pageHref("outPage")}
      />
      <SuppliedUnitsPanel
        rows={detail.units.rows}
        total={detail.units.total}
        page={pages.units}
        pageSize={ORGANIZATION_SECTION_SIZE}
        buildHref={pageHref("unitsPage")}
      />
      {LAB_RESULTS_SHOWN ? (
        <TestsPanel
          rows={detail.tests.rows}
          total={detail.tests.total}
          page={pages.tests}
          pageSize={ORGANIZATION_SECTION_SIZE}
          buildHref={pageHref("testsPage")}
        />
      ) : null}
      <ActivityPanel entries={detail.activity} />
    </div>
  );
}
