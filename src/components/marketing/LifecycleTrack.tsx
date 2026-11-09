"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { gsap } from "./gsap";

/**
 * The lifecycle of genetic material, described without assuming an industry. Wording stays
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

const HUES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
] as const;

const LIVE_COUNT = PHASES.filter((phase) => phase.live).length;
const PLANNED_COUNT = PHASES.length - LIVE_COUNT;

/** Widths at which the track pins and slides sideways; below it the cards simply stack. */
const PIN_QUERY = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";

/**
 * Eight stages on one chain. On wide screens the section pins and the cards slide sideways as the
 * visitor scrolls, with a spectrum rule filling along the bottom; on phones, or with reduced motion,
 * it is an ordinary grid. All text is in the DOM either way.
 */
export function LifecycleTrack({ children }: { children?: ReactNode }) {
  const t = useTranslations("marketing.lifecycle");
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const track = trackRef.current;
    const fill = fillRef.current;
    if (!frame || !track || !fill) return;

    const media = gsap.matchMedia();
    media.add(PIN_QUERY, () => {
      const distance = () => Math.max(track.scrollWidth - frame.clientWidth, 0);

      const timeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: frame,
          // The block is shorter than the screen, so it pins where it already sits (centred) instead
          // of being stretched to fill it; a taller one pins from its top edge.
          start: () => (frame.offsetHeight > window.innerHeight ? "top top" : "center center"),
          end: () => `+=${distance()}`,
          pin: true,
          scrub: 0.7,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });
      timeline.to(track, { x: () => -distance() }, 0).to(fill, { scaleX: 1 }, 0);
    });

    return () => media.revert();
  }, []);

  return (
    <div ref={frameRef} className="relative flex flex-col justify-center overflow-hidden">
      {children ? (
        <div className="mx-auto mb-8 w-full max-w-6xl px-4 sm:px-6">{children}</div>
      ) : null}

      <p className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 text-sm sm:px-6 md:mx-auto md:w-full md:max-w-6xl">
        <span className="inline-flex items-center gap-2 text-fg-secondary">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-accent-text" />
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

      <ol
        ref={trackRef}
        className="grid gap-3 px-4 sm:px-6 md:flex md:w-max md:gap-6 md:ps-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))] md:pe-24"
      >
        {PHASES.map((phase, index) => (
          <li
            key={phase.key}
            style={{ "--hue": HUES[index % HUES.length] } as CSSProperties}
            className={cn(
              "group relative flex flex-col rounded-xl border p-5 transition-transform duration-500 md:min-h-60 md:w-88 md:p-6 md:shrink-0 md:hover:-translate-y-2 motion-reduce:transition-none",
              phase.live ? "border-border bg-surface" : "border-dashed border-border bg-bg"
            )}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-6 top-0 h-px rounded-full bg-(--hue)"
            />
            <span
              aria-hidden="true"
              className="font-mono text-3xl leading-none font-medium text-fg-tertiary md:text-5xl"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="mt-auto pt-4 md:pt-6">
              <div className="flex items-center gap-2.5">
                {phase.live ? (
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text"
                  >
                    <Check className="size-3.5" />
                  </span>
                ) : null}
                <h3 className="text-lg font-semibold tracking-tight">
                  {t(`phases.${phase.key}.label`)}
                </h3>
              </div>
              <p className="mt-3 leading-relaxed text-fg-secondary">
                {t(`phases.${phase.key}.detail`)}
              </p>
              {phase.live ? null : (
                <span className="mt-4 inline-flex rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-fg-secondary">
                  {t("planned")}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div
        aria-hidden="true"
        className="mx-4 mt-6 hidden h-px overflow-hidden bg-border sm:mx-6 md:mx-auto md:block md:w-full md:max-w-6xl"
      >
        <div ref={fillRef} className="size-full origin-left scale-x-0 bg-accent-text" />
      </div>
      <p className="mt-3 hidden font-mono text-xs tracking-[0.14em] text-fg-tertiary uppercase md:mx-auto md:block md:w-full md:max-w-6xl">
        {t("scrollHint")}
      </p>
    </div>
  );
}
