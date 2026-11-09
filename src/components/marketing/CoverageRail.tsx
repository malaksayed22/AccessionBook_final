import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Reveal } from "./motion";

/**
 * The lifecycle of regulated material, described without assuming an industry. Wording stays
 * domain-neutral because the vocabulary a tenant sees comes from their industry pack, not from the
 * platform. `live` says plainly what ships today and what is planned.
 */
const PHASES = [
  { key: "catalogue", live: true },
  { key: "intake", live: true },
  { key: "process", live: true },
  { key: "custody", live: true },
  { key: "testing", live: true },
  { key: "disposition", live: true },
  { key: "packaging", live: false },
  { key: "sale", live: false },
] as const;

const LIVE_COUNT = PHASES.filter((phase) => phase.live).length;
const PLANNED_COUNT = PHASES.length - LIVE_COUNT;

/** Server-rendered; only the staggered fade-in (`Reveal`) is client code. */
export function CoverageRail() {
  const t = useTranslations("marketing.lifecycle");

  return (
    <div>
      <p className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2 text-fg-secondary">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-accent" />
          {t("liveCount", { count: LIVE_COUNT })}
        </span>
        <span className="inline-flex items-center gap-2 text-fg-secondary">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full border border-dashed border-fg-tertiary"
          />
          {t("plannedCount", { count: PLANNED_COUNT })}
        </span>
      </p>

      <div aria-hidden="true" className="mb-6 h-1 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${(LIVE_COUNT / PHASES.length) * 100}%` }}
        />
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PHASES.map((phase, index) => (
          <Reveal key={phase.key} as="li" delay={(index % 4) * 70}>
            <div
              className={cn(
                "h-full rounded-xl border p-4",
                phase.live ? "border-border bg-surface" : "border-dashed border-border bg-bg"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold",
                    phase.live
                      ? "bg-accent-soft text-accent-text"
                      : "border border-dashed border-fg-tertiary text-fg-secondary"
                  )}
                >
                  {phase.live ? <Check className="size-3.5" /> : index + 1}
                </span>
                <h3 className="font-semibold">{t(`phases.${phase.key}.label`)}</h3>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-fg-secondary">
                {t(`phases.${phase.key}.detail`)}
              </p>
              {phase.live ? null : (
                <span className="mt-3 inline-flex rounded-full border border-border px-2 py-0.5 text-xs font-medium text-fg-secondary">
                  {t("planned")}
                </span>
              )}
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}
