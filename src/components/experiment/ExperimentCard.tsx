import { FlaskConical, MapPin, TriangleAlert, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { EntityLink } from "@/components/page/EntityLink";
import { richValue } from "@/components/page/rich-value";
import { Badge } from "@/components/ui/Badge";
import { CALENDAR_DAY_FORMAT } from "@/features/experiment/dates";
import type { ExperimentListRow } from "@/features/experiment/queries";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ExperimentBars } from "./ExperimentBars";
import { ExperimentStatusBadge } from "./ExperimentStatusBadge";

/*
 * One experiment as a card. The whole card is one link (the experiment name's link is stretched over
 * it), so there is a single tab stop per card and the accessible name is the experiment.
 */
const MAX_LOCATIONS = 2;

export function ExperimentCard({ experiment }: { experiment: ExperimentListRow }) {
  const t = useTranslations("experiments.card");
  const format = useFormatter();
  const { stats } = experiment;
  const lead = experiment.members.find((m) => m.role === "LEAD") ?? experiment.members[0];
  const others = experiment.members.length - (lead ? 1 : 0);
  const shownLocations = stats.locations.slice(0, MAX_LOCATIONS);
  const hiddenLocations = stats.locations.length - shownLocations.length;

  return (
    <article
      className={cn(
        "relative grid h-full row-span-7 grid-rows-subgrid gap-y-0 rounded-xl border border-border bg-surface p-4 shadow-sm",
        "transition-colors duration-150 hover:border-border-strong hover:bg-hover motion-reduce:transition-none",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus"
      )}
    >
      <header className="row-start-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-accent-text">
            <FlaskConical aria-hidden="true" className="size-4" />
            {experiment.ecode}
          </span>
          <span className="relative z-10">
            <ExperimentStatusBadge status={experiment.status} />
          </span>
        </div>
        <h2 className="text-base leading-snug font-semibold text-fg wrap-break-word">
          <Link
            href={`/inventory/experiments/${experiment.id}`}
            className="outline-none after:absolute after:inset-0 after:rounded-xl hover:underline"
          >
            {experiment.name}
          </Link>
        </h2>
        {experiment.parent ? (
          <p className="text-sm text-fg-secondary">
            {t.rich("subExperimentOf", {
              code: richValue(
                <EntityLink
                  kind="experiment"
                  id={experiment.parent.id}
                  className="relative z-10 font-mono"
                >
                  {experiment.parent.ecode}
                </EntityLink>
              ),
            })}
          </p>
        ) : null}
      </header>

      <dl className="row-start-2 grid grid-cols-2 content-start gap-x-4 gap-y-3 pt-4 text-sm">
        <div>
          <dt className="text-fg-secondary">{t("started")}</dt>
          <dd className="text-fg">
            <time dateTime={experiment.startDate.toISOString()}>
              {format.dateTime(experiment.startDate, CALENDAR_DAY_FORMAT)}
            </time>
          </dd>
        </div>
        {!experiment.endDate && experiment.estimatedEndDate ? (
          <div>
            <dt className="text-fg-secondary">{t("estimatedEnd")}</dt>
            <dd className="text-fg">
              <time dateTime={experiment.estimatedEndDate.toISOString()}>
                {format.dateTime(experiment.estimatedEndDate, CALENDAR_DAY_FORMAT)}
              </time>
            </dd>
          </div>
        ) : null}
        {experiment.endDate ? (
          <div>
            <dt className="text-fg-secondary">{t("completedOn")}</dt>
            <dd className="text-fg">
              <time dateTime={experiment.endDate.toISOString()}>
                {format.dateTime(experiment.endDate, CALENDAR_DAY_FORMAT)}
              </time>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-fg-secondary">{t("units")}</dt>
          <dd className="text-fg tabular-nums">
            <Link
              href={`/inventory/experiments/${experiment.id}#units`}
              className="relative z-10 text-accent-text hover:underline"
            >
              {t("unitsInInventory", { inventory: stats.active, total: experiment.unitCount })}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-fg-secondary">{t("team")}</dt>
          <dd className="flex items-start gap-1.5 text-fg">
            <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-tertiary" />
            <span className="min-w-0 wrap-break-word">
              {lead ? (
                <>
                  <EntityLink kind="member" id={lead.userId} className="relative z-10">
                    {lead.name}
                  </EntityLink>
                  {others > 0 ? ` ${t("andOthers", { count: others })}` : null}
                </>
              ) : (
                t("noTeam")
              )}
            </span>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-fg-secondary">{t("locations")}</dt>
          <dd className="flex items-start gap-1.5 text-fg">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-tertiary" />
            <span className="min-w-0 wrap-break-word">
              {shownLocations.length > 0
                ? shownLocations.map((l, index) => (
                    <span key={l.id}>
                      {index > 0 ? ", " : null}
                      <EntityLink kind="location" id={l.id} className="relative z-10">
                        {l.name}
                      </EntityLink>
                    </span>
                  ))
                : t("noLocations")}
              {shownLocations.length > 0 && hiddenLocations > 0
                ? ` ${t("andMore", { count: hiddenLocations })}`
                : null}
            </span>
          </dd>
        </div>
      </dl>

      <ExperimentBars
        counts={stats}
        types={stats.types}
        timeline={stats.timeline}
        className="row-span-3 row-start-3 grid grid-rows-subgrid gap-y-0 space-y-0 *:pt-4"
      />

      {stats.onHold > 0 ? (
        <div className="row-start-6 pt-4">
          <Badge
            tone="warning"
            icon={<TriangleAlert />}
            href={`/inventory/experiments/${experiment.id}?status=hold#units`}
            className="relative z-10"
          >
            {t("onHold", { count: stats.onHold })}
          </Badge>
        </div>
      ) : null}

      {experiment.comment ? (
        <p className="row-start-7 mt-4 line-clamp-2 border-t border-border pt-3 text-sm text-fg-secondary">
          {experiment.comment}
        </p>
      ) : null}
    </article>
  );
}
