"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  Cannabis,
  Check,
  FileText,
  FlaskConical,
  GitBranch,
  History,
  ScanBarcode,
  ScrollText,
  ShieldCheck,
  Sprout,
  Undo2,
  Users,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { gsap, REDUCED_MOTION_QUERY } from "./gsap";

const CORE: ReadonlyArray<{
  key: "history" | "lineage" | "custody" | "quality" | "recall" | "audit" | "teams" | "reporting";
  icon: LucideIcon;
}> = [
  { key: "history", icon: History },
  { key: "lineage", icon: GitBranch },
  { key: "custody", icon: ScanBarcode },
  { key: "quality", icon: ShieldCheck },
  { key: "recall", icon: Undo2 },
  { key: "audit", icon: ScrollText },
  { key: "teams", icon: Users },
  { key: "reporting", icon: FileText },
];

/**
 * A pack supplies the vocabulary and the statutory return for one industry. Only some exist today;
 * the rest are labelled "Planned" rather than implied as available.
 */
const PACKS: ReadonlyArray<{
  key: "cannabis" | "plants" | "biotech" | "food";
  live: boolean;
  icon: LucideIcon;
}> = [
  { key: "cannabis", live: true, icon: Cannabis },
  { key: "plants", live: true, icon: Sprout },
  { key: "biotech", live: false, icon: FlaskConical },
  { key: "food", live: false, icon: Wheat },
];

const POINTS = ["one", "two", "three"] as const;

/**
 * The industry packs as four selectable cards stacked on top of the platform core, which is the
 * structure the copy describes: what changes by industry sits on a core that never does. The chosen
 * pack opens as a panel straight below its card; a thin rail with a travelling pulse joins the panel
 * to the core's base slab. The core's capabilities rise in once as they scroll into view; a pack's
 * details settle in each time its tab opens.
 */
export function Verticals() {
  const t = useTranslations("marketing.industries");
  const coreRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = coreRef.current;
    if (!list || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const scope = gsap.context(() => {
      gsap.from(list.children, {
        autoAlpha: 0,
        y: 18,
        duration: 0.9,
        stagger: 0.06,
        ease: "expo.out",
        scrollTrigger: { trigger: list, start: "top 90%", once: true },
      });
    }, list);
    return () => scope.revert();
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-xl font-semibold tracking-tight">{t("packsTitle")}</h3>
        <p className="text-sm text-fg-secondary">{t("packsNote")}</p>
      </div>

      <TabsPrimitive.Root defaultValue="cannabis" className="mt-5">
        <TabsPrimitive.List
          aria-label={t("packsLabel")}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {PACKS.map(({ key, live, icon: Icon }) => (
            <TabsPrimitive.Trigger
              key={key}
              value={key}
              className={cn(
                "group relative flex min-h-28 flex-col items-start justify-between gap-5 overflow-hidden rounded-2xl border p-4 text-start",
                "transition-[border-color,background-color,box-shadow,translate] duration-300 ease-out motion-reduce:transition-none",
                live ? "border-border bg-surface" : "border-dashed border-border bg-transparent",
                "hover:-translate-y-0.5 hover:border-border-strong",
                "data-[state=active]:-translate-y-0.5 data-[state=active]:border-accent-text data-[state=active]:bg-accent-soft data-[state=active]:shadow-[0_10px_32px_-14px_var(--color-accent-text)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              )}
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-xl border border-border bg-bg text-fg-secondary transition-colors duration-300 group-data-[state=active]:border-accent-text group-data-[state=active]:bg-accent group-data-[state=active]:text-on-accent"
                >
                  <Icon className="size-5" />
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.75rem] font-semibold",
                    live
                      ? "border-accent-soft-border bg-accent-soft text-accent-text"
                      : "border-border text-fg-secondary"
                  )}
                >
                  {live ? (
                    <span
                      aria-hidden="true"
                      className="live-dot size-1.5 rounded-full bg-accent-text"
                    />
                  ) : null}
                  {live ? t("live") : t("planned")}
                </span>
              </span>
              <span className="text-sm leading-snug font-semibold text-fg-secondary transition-colors duration-300 group-hover:text-fg group-data-[state=active]:text-fg">
                {t(`packs.${key}.name`)}
              </span>
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        {PACKS.map(({ key, live }) => (
          <TabsPrimitive.Content
            key={key}
            value={key}
            className="pack-in relative mt-3 grid gap-x-12 gap-y-6 overflow-hidden rounded-2xl border border-border bg-surface p-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:p-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:items-center"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-accent-text to-transparent opacity-80"
            />
            <div>
              <p className="font-mono text-xs tracking-[0.14em] text-accent-text uppercase">
                {live ? t("live") : t("planned")}
              </p>
              <h4 className="mt-2 text-2xl font-semibold tracking-tight">
                {t(`packs.${key}.name`)}
              </h4>
              <p className="mt-3 max-w-xl leading-relaxed text-fg-secondary">
                {t(`packs.${key}.detail`)}
              </p>
            </div>
            <ul className="space-y-2.5">
              {POINTS.map((point) => (
                <li
                  key={point}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3 text-sm"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text"
                  >
                    <Check className="size-3.5" />
                  </span>
                  <span className="text-fg-secondary">{t(`packs.${key}.points.${point}`)}</span>
                </li>
              ))}
            </ul>
          </TabsPrimitive.Content>
        ))}
      </TabsPrimitive.Root>

      <div
        aria-hidden="true"
        className="relative mx-auto h-10 w-px overflow-hidden bg-border-strong"
      >
        <span className="rail-pulse absolute inset-x-0 top-0 h-4 bg-linear-to-b from-transparent via-accent-text to-transparent" />
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border bg-sunken p-6 sm:p-8">
        <span
          aria-hidden="true"
          className="absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-border-strong to-transparent"
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-xl font-semibold tracking-tight">{t("coreTitle")}</h3>
          <p className="text-sm text-fg-secondary">{t("coreNote")}</p>
        </div>
        <ul ref={coreRef} className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {CORE.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-sm transition-[border-color,translate] duration-300 hover:-translate-y-0.5 hover:border-accent-text motion-reduce:transition-none"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text transition-colors duration-300 group-hover:bg-accent group-hover:text-on-accent"
              >
                <Icon className="size-4" />
              </span>
              <span className="leading-snug text-fg-secondary transition-colors duration-300 group-hover:text-fg">
                {t(`core.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
