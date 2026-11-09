import { useFormatter, useTranslations } from "next-intl";
import { EntityLink } from "@/components/page/EntityLink";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { UnitLocationHistory } from "@/components/UnitLocationHistory";
import { UnitStageDurations } from "@/components/UnitStageDurations";
import type { UnitProfile } from "@/features/unit/queries";
import type { ShipmentEntry } from "@/lib/unit-shipping";
import { Link } from "@/i18n/navigation";
import { ActionButton } from "./UnitActions";
import { Day, Fact, FactList, Grams, Stamp, When, linkClass } from "./common";

/**
 * Overview tab: where the unit has been and how long each stage took, then its facts, provenance and
 * notes. The cards carry no descriptions: their titles and facts say enough.
 */
export function UnitOverview({ profile }: { profile: UnitProfile }) {
  const t = useTranslations("units.panels.overview");
  const detail = useTranslations("units.detail");
  const domain = useTranslations("domain");
  const format = useFormatter();
  const { current, source } = profile;
  const empty = domain("empty");

  const stageText = (() => {
    if (profile.terminal === "DESTROYED") return domain("stateKind.DESTROYED");
    if (profile.type === "SEEDLOT") {
      return current?.seedCount != null
        ? t("seedLotCount", { count: current.seedCount })
        : domain("unitType.SEEDLOT");
    }
    if (profile.type === "CULTURE") return t("inCulture");
    if (!current?.growthStage) return empty;
    return (
      <Link href={`/inventory/units?stage=${current.growthStage}`} className={linkClass}>
        {domain(`growthStage.${current.growthStage}`)}
      </Link>
    );
  })();
  const showWeights = profile.type === "PLANT" || profile.type === "FLOWER";
  const measuredOn = profile.weights.changedAt;
  const weighed = (value: number | null) => (
    <>
      <Grams value={value} />
      {value !== null && measuredOn ? (
        <span className="block text-xs font-normal text-fg-secondary">
          {t("measuredOn")} <Day value={measuredOn} />
        </span>
      ) : null}
    </>
  );

  // Shipping is not a status: every shipment that took something is listed, oldest first, with what
  // it took and what was left after it.
  const shipping = profile.shipping;
  const amount = (value: number | null, measure: ShipmentEntry["measure"]) =>
    value === null ? empty : format.number(value, measure === "seeds" ? "count" : "grams");
  const shipmentDetail = (entry: ShipmentEntry) => {
    if (entry.measure === "whole") return t("shipmentWhole");
    if (entry.measure === "part") {
      return t("shipmentPart", {
        material: entry.materialType
          ? domain(`materialClass.${entry.materialType as "SEED"}`)
          : empty,
        shipped: entry.shipped === null ? empty : format.number(entry.shipped),
      });
    }
    // "Dry · Original: 165 g · Shipped: 80 g · Left: 85 g": each amount after its label.
    const part = (label: string, value: string) => (
      <span className="whitespace-nowrap">
        {label}: <span className="font-medium text-fg">{value}</span>
      </span>
    );
    return (
      <>
        {t(`shipmentMeasure.${entry.measure}`)}
        {" · "}
        {part(t("shipmentAmount.original"), amount(entry.original, entry.measure))}
        {" · "}
        {part(t("shipmentAmount.shipped"), amount(entry.shipped, entry.measure))}
        {" · "}
        {part(t("shipmentAmount.left"), amount(entry.left, entry.measure))}
      </>
    );
  };
  // A dry weight: what was weighed before anything shipped, and what is left now.
  const originalDry = shipping?.dry?.original ?? profile.weights.dry;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {profile.type === "PLANT" || profile.type === "FLOWER" ? (
          <UnitStageDurations summary={profile.stageDurations} />
        ) : null}
        <UnitLocationHistory history={profile.locationHistory} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelBody className="space-y-3">
            <div className="flex justify-end">
              <ActionButton action="editDetails" size="sm">
                {t("editFacts")}
              </ActionButton>
            </div>
            <FactList>
              <Fact label={t("cultivar")}>
                {profile.cultivar ? (
                  <Link href={`/records/cultivars/${profile.cultivar.id}`} className={linkClass}>
                    {profile.cultivar.name}
                  </Link>
                ) : (
                  empty
                )}
              </Fact>
              <Fact label={t("experiment")}>
                {profile.experiment ? (
                  <Link
                    href={`/inventory/experiments/${profile.experiment.id}`}
                    className={linkClass}
                  >
                    {profile.experiment.ecode} · {profile.experiment.name}
                  </Link>
                ) : (
                  empty
                )}
              </Fact>
              <Fact label={t("location")}>
                <EntityLink kind="location" id={current?.locationId}>
                  {current?.locationName ?? empty}
                </EntityLink>
              </Fact>
              <Fact label={t("stage")}>{stageText}</Fact>
              <Fact label={t("material")}>{detail(`material.${profile.material}`)}</Fact>
              {profile.projection?.floweringOn ? (
                <Fact label={t("expectedFlowering")}>
                  {format.dateTime(profile.projection.floweringOn, "date")}
                </Fact>
              ) : null}
              {profile.projection?.harvestOn ? (
                <Fact label={t("expectedHarvest")}>
                  {format.dateTime(profile.projection.harvestOn, "date")}
                </Fact>
              ) : null}
              {profile.projection?.expectedYieldGrams != null ? (
                <Fact label={t("expectedYield")}>
                  {t("expectedYieldValue", {
                    value: format.number(profile.projection.expectedYieldGrams, "grams"),
                  })}
                </Fact>
              ) : null}
              {profile.type === "PLANT" ? (
                <Fact label={t("plants")}>{format.number(current?.plantCount ?? 1, "count")}</Fact>
              ) : null}
              <Fact label={t("sex")}>
                {profile.sex
                  ? profile.sex === "MALE" ||
                    profile.sex === "FEMALE" ||
                    profile.sex === "HERMAPHRODITE"
                    ? t(`sexValues.${profile.sex}`)
                    : profile.sex
                  : empty}
              </Fact>
              {showWeights ? (
                <>
                  <Fact label={t("humidWeight")}>{weighed(profile.weights.humid)}</Fact>
                  <Fact label={t("originalDryWeight")}>
                    <Grams value={originalDry} />
                    {originalDry !== null && profile.weights.dryMeasuredAt ? (
                      <span className="block text-xs font-normal text-fg-secondary">
                        {t("measuredOn")} <Day value={profile.weights.dryMeasuredAt} />
                      </span>
                    ) : null}
                  </Fact>
                  <Fact label={t("remainingDryWeight")}>{weighed(profile.weights.dry)}</Fact>
                </>
              ) : null}
              {profile.type === "SEEDLOT" ? (
                <Fact label={t("seedCount")}>
                  {current?.seedCount != null ? format.number(current.seedCount, "count") : empty}
                </Fact>
              ) : null}
              {shipping ? (
                <Fact label={t("shipped")} wide>
                  <ol className="mt-1 space-y-3 border-s-2 border-border-strong ps-4">
                    {shipping.entries.map((entry, index) => (
                      <li key={entry.shipment?.id ?? index} className="relative">
                        <span
                          aria-hidden="true"
                          className="absolute -start-[1.375rem] top-1.5 size-2.5 rounded-full bg-accent"
                        />
                        <span className="block text-sm font-medium text-fg">
                          {entry.at ? <Day value={entry.at} /> : empty}
                          {entry.organization ? (
                            <>
                              {" · "}
                              <EntityLink kind="organization" id={entry.organization.id}>
                                {entry.organization.name}
                              </EntityLink>
                            </>
                          ) : null}
                          {entry.shipment ? (
                            <>
                              {" · "}
                              <Link
                                href={`/inventory/materials/${entry.shipment.id}`}
                                className={linkClass}
                              >
                                {entry.shipment.reference}
                              </Link>
                            </>
                          ) : null}
                        </span>
                        <span className="block text-sm text-fg-secondary">
                          {shipmentDetail(entry)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Fact>
              ) : null}
              <Fact label={t("registered")}>
                <When value={profile.registeredAt} />
                {/* A back-dated registration says when it was actually written down. */}
                {Math.abs(profile.createdAt.getTime() - profile.registeredAt.getTime()) > 60_000 ? (
                  <span className="block text-fg-secondary">
                    {t("filedOn")} <When value={profile.createdAt} />
                  </span>
                ) : null}
              </Fact>
              <Fact label={t("lastEvent")} wide>
                {current ? (
                  <span className="flex flex-col">
                    <span>
                      {domain(`stateKind.${current.kind}`)} ·{" "}
                      {t("sequence", { number: current.sequence })}
                    </span>
                    <Stamp
                      who={current.recordedBy}
                      whoId={current.recordedById}
                      at={current.recordedAt}
                    />
                  </span>
                ) : (
                  empty
                )}
              </Fact>
            </FactList>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title={t("sourceTitle")} />
          <PanelBody>
            <FactList>
              <Fact label={t("sourceType")}>
                {source.type ? domain(`sourceType.${source.type}`) : empty}
              </Fact>
              <Fact label={t("provider")}>
                {source.provider ? (
                  <>
                    <EntityLink kind="organization" id={source.provider.id}>
                      {source.provider.name}
                    </EntityLink>
                    {source.provider.country ? ` (${source.provider.country})` : null}
                  </>
                ) : (
                  t("internal")
                )}
              </Fact>
              {source.provider ? (
                <>
                  <Fact label={t("receivedOn")}>
                    <Day value={source.receivedAt} />
                  </Fact>
                  <Fact label={t("receptionNotes")}>{source.receptionNote ?? empty}</Fact>
                </>
              ) : null}
              <Fact label={t("parent")} wide>
                {profile.parent ? (
                  <Link href={`/inventory/units/${profile.parent.id}`} className={linkClass}>
                    {profile.parent.name}
                  </Link>
                ) : (
                  empty
                )}
              </Fact>
              <Fact label={t("sourceNote")} wide>
                {source.description ?? empty}
              </Fact>
            </FactList>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={t("notesTitle")} actions={<ActionButton action="edit" />} />
        <PanelBody>
          {profile.notes ? (
            <p className="whitespace-pre-wrap text-sm text-fg">{profile.notes}</p>
          ) : (
            <p className="text-sm text-fg-secondary">{t("noNotes")}</p>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
