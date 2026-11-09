import { ScanLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { EntityLink } from "@/components/page/EntityLink";
import { richValue } from "@/components/page/rich-value";
import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Day } from "@/components/unit/common";
import type { LocationHistory } from "@/lib/traceability";
import { cn } from "@/lib/utils";

/** Every room the unit has occupied, from its MOVED events: who moved it, when, and for how long. */
export function UnitLocationHistory({ history }: { history: LocationHistory }) {
  const t = useTranslations("units.panels.locations");
  const { stays, current } = history;

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        actions={
          current ? (
            <p className="text-sm text-fg-secondary">
              {t.rich("inRoom", {
                location: richValue(
                  <EntityLink kind="location" id={current.locationId}>
                    {current.locationName}
                  </EntityLink>
                ),
                count: current.days,
              })}
            </p>
          ) : undefined
        }
      />
      <PanelBody className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-border bg-sunken p-4">
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("rooms")}
            </dt>
            <dd className="mt-1.5 text-xl font-semibold text-fg tabular-nums">
              {history.distinctLocations}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-sunken p-4">
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("moves")}
            </dt>
            <dd className="mt-1.5 text-xl font-semibold text-fg tabular-nums">
              {history.totalMoves}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-sunken p-4">
            <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
              {t("daysTracked")}
            </dt>
            <dd className="mt-1.5 text-xl font-semibold text-fg tabular-nums">
              {stays.reduce((sum, stay) => sum + stay.days, 0)}
            </dd>
          </div>
        </dl>

        {stays.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-fg-secondary">
            {t("empty")}
          </p>
        ) : (
          <ol className="relative space-y-4 border-s border-border ps-5">
            {[...stays].reverse().map((stay, index) => (
              <li key={`${stay.locationId}-${index}`} className="relative">
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1.5 -start-[27px] size-3 rounded-full border-2 border-surface",
                    stay.current ? "bg-success-solid" : "bg-fg-tertiary"
                  )}
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                    <EntityLink kind="location" id={stay.locationId}>
                      {stay.locationName}
                    </EntityLink>
                    {stay.current ? <Badge tone="success">{t("current")}</Badge> : null}
                    {stay.scanConfirmed ? (
                      <Badge tone="neutral" icon={<ScanLine />}>
                        {t("scanConfirmed")}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-sm text-fg-secondary tabular-nums">
                    {t("days", { count: stay.days })}
                  </p>
                </div>
                <p className="text-sm text-fg-secondary">
                  <Day value={stay.from} /> → {stay.to ? <Day value={stay.to} /> : t("present")}
                  {stay.movedBy ? ` · ${t("movedBy", { name: stay.movedBy })}` : ""}
                </p>
                {stay.comment ? <p className="text-sm text-fg-secondary">{stay.comment}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </PanelBody>
    </Panel>
  );
}
