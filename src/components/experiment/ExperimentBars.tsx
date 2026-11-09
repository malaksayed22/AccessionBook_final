import { useTranslations } from "next-intl";
import { ProportionBar } from "@/components/charts/ProportionBar";
import { STATUS } from "@/components/charts/palette";
import type { StageSpan } from "@/lib/experiment-progress";
import { cn } from "@/lib/utils";
import { StageTimeline } from "./StageTimeline";

type Types = ReadonlyArray<{ type: string; count: number }>;

/**
 * An experiment's three bars, in this order: a timeline of when each lifecycle stage started and
 * ended, what kinds of unit there are, and how many units are in each status. Used on the list cards and on the
 * experiment page.
 */
export function ExperimentBars({
  counts,
  types,
  timeline,
  className,
}: {
  /** How many units are in each status, as the units list counts them. */
  counts: { active: number; onHold: number; nothingLeft: number; destroyed: number };
  types: Types;
  timeline: readonly StageSpan[];
  className?: string;
}) {
  const t = useTranslations("experiments.bars");
  const domain = useTranslations("domain");

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg">{t("stageTimeline")}</p>
        <StageTimeline spans={timeline} now={new Date()} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-fg">{t("types")}</p>
        <ProportionBar
          label={t("types")}
          empty={t("noUnits")}
          segments={types.map(({ type, count }) => ({
            key: type,
            label: domain(`unitTypePlural.${type as "PLANT"}`),
            value: count,
          }))}
        />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-fg">{t("statuses")}</p>
        <ProportionBar
          label={t("statuses")}
          empty={t("noUnits")}
          segments={[
            {
              key: "active",
              label: domain("unitStatus.active"),
              value: counts.active,
              gradient: STATUS.good,
            },
            {
              key: "on-hold",
              label: domain("unitStatus.on-hold"),
              value: counts.onHold,
              gradient: STATUS.caution,
            },
            {
              key: "nothing-left",
              label: domain("unitStatus.nothingLeft"),
              value: counts.nothingLeft,
              gradient: STATUS.neutral,
            },
            {
              key: "destroyed",
              label: domain("unitStatus.destroyed"),
              value: counts.destroyed,
              gradient: STATUS.bad,
            },
          ]}
        />
      </div>
    </div>
  );
}
