import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EntityLink } from "@/components/page/EntityLink";
import { richValue } from "@/components/page/rich-value";
import { HoldBadge, UnitStatusBadge, UnitTypeBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { PageHeader } from "@/components/ui/PageHeader";
import { UnitHierarchyPanel } from "@/components/UnitHierarchyPanel";
import { UnitQaPanels } from "@/components/UnitQaPanels";
import { UnitExtrasPanels } from "@/components/UnitExtrasPanels";
import { LedgerList } from "@/components/unit/LedgerList";
import {
  ActionButton,
  ActionsMenu,
  LabelMenu,
  RecordsMenu,
  UnitActionsProvider,
} from "@/components/unit/UnitActions";
import { UnitOverview } from "@/components/unit/UnitOverview";
import { UnitTabs, type UnitTabId } from "@/components/unit/UnitTabs";
import type { ActionUnit, Option } from "@/components/unit/action-types";
import { When } from "@/components/unit/common";
import type { UnitDocuments, UnitProfile, UnitQuality } from "@/features/unit/queries";
import type { LedgerEvent } from "@/lib/ledger-types";
import { availabilityMap } from "@/lib/unit-actions";

/**
 * The unit as a record: who and what it is, whether anything stops it moving, and tabs for its
 * history, lineage, quality and documents. Everything shown is read on the server; the actions grid
 * and the forms behind it are the only client code, and the server re-checks every request.
 */
export function UnitProfileView({
  profile,
  ledger,
  quality,
  documents,
  locations,
  profileUrl,
  tab,
  breadcrumbs,
}: {
  profile: UnitProfile;
  ledger: LedgerEvent[];
  quality: UnitQuality;
  documents: UnitDocuments;
  /** Active locations, for the move and derive forms (empty when the user cannot edit). */
  locations: Option[];
  profileUrl: string;
  tab: UnitTabId;
  /** Trail above the title; built on the server, so it is passed in. */
  breadcrumbs?: ReactNode;
}) {
  const t = useTranslations("units.detail");
  const domain = useTranslations("domain");

  const availability = availabilityMap({
    type: profile.type,
    terminal: profile.terminal,
    onHold: profile.hold !== null,
    hasParent: profile.parent !== null,
    canEdit: profile.access.canEdit,
    isAdmin: profile.access.isAdmin,
    canRecordQuality: profile.access.canRecordQuality,
    canReleaseHold: profile.access.canReleaseHold,
    canDestroy: profile.access.canDestroy,
    weighed:
      profile.type === "FLOWER" ||
      (profile.type === "PLANT" &&
        ["HARVESTED", "DRYING", "CURING", "STORAGE"].includes(profile.current?.growthStage ?? "")),
    plants: profile.current?.plantCount ?? 1,
    weights: { wet: profile.weights.humid !== null, dry: profile.weights.dry !== null },
  });
  const unit: ActionUnit = {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    locationId: profile.current?.locationId ?? null,
    growthStage: profile.current?.growthStage ?? null,
    humidWeight: profile.weights.humid,
    dryWeight: profile.weights.dry,
    seedCount: profile.current?.seedCount ?? null,
    plantCount: profile.current?.plantCount ?? null,
    sex: profile.sex,
    notes: profile.notes,
    terminal: profile.terminal,
    experiment: profile.experiment
      ? {
          id: profile.experiment.id,
          ecode: profile.experiment.ecode,
          name: profile.experiment.name,
        }
      : null,
    tissueSamples: quality.tissueSamples.map((sample) => ({ id: sample.id, code: sample.code })),
  };

  const subtitle = (
    <>
      {domain(`unitType.${profile.type}`)}
      {profile.cultivar ? (
        <>
          {" · "}
          <EntityLink kind="cultivar" id={profile.cultivar.id}>
            {profile.cultivar.name}
          </EntityLink>
        </>
      ) : null}
      {profile.experiment ? (
        <>
          {" · "}
          <EntityLink kind="experiment" id={profile.experiment.id}>
            {profile.experiment.ecode}
          </EntityLink>
        </>
      ) : null}
    </>
  );

  return (
    <UnitActionsProvider
      unit={unit}
      availability={availability}
      locations={locations}
      canAddLocation={profile.access.isAdmin}
    >
      <PageHeader
        breadcrumbs={breadcrumbs}
        className="pb-3"
        title={
          <>
            <span className="me-3 font-mono text-fg-secondary">{profile.code}</span>
            {profile.name}
          </>
        }
        description={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RecordsMenu />
            <LabelMenu
              label={{
                unitTypeLabel: domain(`unitType.${profile.type}`),
                cultivarName: profile.cultivar?.name,
                profileUrl,
                mother: profile.lineage.mother,
              }}
            />
            <ActionsMenu />
          </div>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <UnitTypeBadge type={profile.type} />
        <UnitStatusBadge
          status={profile.status}
          nothingLeft={profile.terminal === "SHIPPED" || profile.terminal === "MERGED"}
        />
        {profile.hold && profile.status !== "on-hold" ? (
          <HoldBadge kind={profile.hold.kind} />
        ) : null}
        {/* The material only adds something when it differs from the type (a plant is a plant). */}
        {profile.material !== profile.type ? (
          <Badge>{t(`material.${profile.material}`)}</Badge>
        ) : null}
      </div>

      <div className="mb-6 space-y-3">
        <Banners profile={profile} />
      </div>

      <UnitTabs
        label={t("tabsLabel")}
        initial={tab}
        tabs={[
          { id: "overview", label: t("tabs.overview") },
          { id: "history", label: t("tabs.history"), count: ledger.length },
          { id: "lineage", label: t("tabs.lineage") },
          {
            id: "quality",
            label: t("tabs.quality"),
            // Lab results are set aside for now: the tab counts incidents.
            count: quality.incidents.length,
          },
          {
            id: "documents",
            label: t("tabs.documents"),
            count: documents.attachments.length,
          },
        ]}
        panels={{
          overview: <UnitOverview profile={profile} />,
          history: (
            <LedgerList events={ledger} exportHref={`/inventory/units/${profile.id}/export`} />
          ),
          lineage: <UnitHierarchyPanel profile={profile} />,
          quality: <UnitQaPanels quality={quality} />,
          documents: <UnitExtrasPanels unitId={profile.id} documents={documents} />,
        }}
      />
    </UnitActionsProvider>
  );
}

/** What stops the unit, and why: a final state, a quality hold, or no right to change it. */
function Banners({ profile }: { profile: UnitProfile }) {
  const t = useTranslations("units.detail.banners");
  const domain = useTranslations("domain");
  const { hold, destruction, shipment } = profile;

  return (
    <>
      {destruction ? (
        <Banner tone="danger" title={t("destroyedTitle")}>
          <p>
            {t.rich("destroyedBody", {
              by: richValue(
                <EntityLink kind="member" id={destruction.recordedById}>
                  {destruction.recordedBy ?? domain("empty")}
                </EntityLink>
              ),
            })}{" "}
            <When value={destruction.at} />
          </p>
          <p>
            <span className="font-medium">{t("reason")}</span>{" "}
            {destruction.reason ?? domain("empty")}
          </p>
          {destruction.witness ? (
            <p>
              <span className="font-medium">{t("witness")}</span>{" "}
              <EntityLink kind="member" id={destruction.witnessId}>
                {destruction.witness}
              </EntityLink>
            </p>
          ) : null}
          <p className="mt-1">{t("destroyedReadOnly")}</p>
        </Banner>
      ) : null}

      {shipment ? (
        <Banner tone="info" title={t("shippedTitle")}>
          <p>
            {shipment.organization
              ? t.rich("shippedTo", {
                  organization: richValue(
                    <EntityLink kind="organization" id={shipment.organizationId}>
                      {shipment.organization}
                    </EntityLink>
                  ),
                })
              : t("shippedUnknown")}{" "}
            <When value={shipment.at} />
          </p>
          <p className="mt-1">{t("shippedReadOnly")}</p>
        </Banner>
      ) : null}

      {profile.sampleKind && profile.parent ? (
        <Banner
          tone="info"
          title={t("sampleTitle", { kind: domain(`sampleKind.${profile.sampleKind}`) })}
        >
          <p>
            {t.rich("sampleBody", {
              parent: richValue(
                <EntityLink kind="unit" id={profile.parent.id}>
                  {profile.parent.name}
                </EntityLink>
              ),
            })}{" "}
            <When value={profile.registeredAt} />
          </p>
        </Banner>
      ) : null}

      {profile.merge ? (
        <Banner tone="info" title={t("mergedTitle")}>
          <p>
            {profile.merge.into
              ? t.rich("mergedInto", {
                  group: richValue(
                    <EntityLink kind="unit" id={profile.merge.into.id}>
                      {profile.merge.into.name}
                    </EntityLink>
                  ),
                })
              : t("mergedUnknown")}{" "}
            <When value={profile.merge.at} />
          </p>
          <p className="mt-1">{t("shippedReadOnly")}</p>
        </Banner>
      ) : null}

      {hold ? (
        <Banner tone="warning" title={t("holdTitle", { kind: domain(`holdKind.${hold.kind}`) })}>
          <p>
            <span className="font-medium">{t("reason")}</span> {hold.reason}
          </p>
          <p>
            {t.rich("holdPlaced", {
              by: richValue(
                <EntityLink kind="member" id={hold.placedById}>
                  {hold.placedBy}
                </EntityLink>
              ),
              origin: domain(`holdOrigin.${hold.origin}`),
            })}{" "}
            <When value={hold.placedAt} />
          </p>
          <p className="mt-1">{t("holdEffect")}</p>
          {profile.access.canReleaseHold ? (
            <div className="mt-3">
              <ActionButton action="releaseHold" variant="primary" />
            </div>
          ) : (
            <p className="mt-1 font-medium">{t("holdAdminOnly")}</p>
          )}
        </Banner>
      ) : null}

      {!profile.terminal && !profile.access.canEdit && !profile.access.canRecordQuality ? (
        <Banner tone="info">{t("readOnly")}</Banner>
      ) : null}
    </>
  );
}
