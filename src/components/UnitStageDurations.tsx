import { useTranslations } from "next-intl";
import { StageTimeline } from "@/components/experiment/StageTimeline";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Day } from "@/components/unit/common";
import { buildStageSpans, type StageBucket } from "@/lib/experiment-progress";
import type { LifecycleStageId } from "@/lib/lifecycle-stages";
import type { StageDurationSummary } from "@/lib/stage-durations";

/**
 * When the unit entered and left each phase of its lifecycle, derived from its stage-change events,
 * drawn as one timeline bar with each stage's dates and days under it (the same bar an experiment
 * shows). The numbers carry the meaning, so nothing depends on colour or bar length alone.
 */
export function UnitStageDurations({ summary }: { summary: StageDurationSummary }) {
  const t = useTranslations("units.panels.timing");
  const domain = useTranslations("domain");
  const { spans, current, totalDays } = summary;
  const now = new Date();
  const timeline = buildStageSpans(
    spans.map((span) => ({
      stage: span.stage as StageBucket,
      started: span.start,
      ended: span.ongoing ? null : span.end,
    })),
    now
  );

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        actions={
          current ? (
            <p className="text-sm font-medium text-fg">
              {t("currently", {
                stage: domain(`growthStage.${current.stage as LifecycleStageId}`),
                day: current.days,
              })}
            </p>
          ) : undefined
        }
      />
      <PanelBody className="space-y-4">
        {spans.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-fg-secondary">
            {t("empty")}
          </p>
        ) : (
          <>
            <StageTimeline spans={timeline} now={now} detail />
            <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="text-fg-secondary">
                {t("trackedSince")} <Day value={spans[0]?.start ?? null} />
              </span>
              <span className="font-medium text-fg">{t("total", { count: totalDays })}</span>
            </p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
