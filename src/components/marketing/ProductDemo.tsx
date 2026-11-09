"use client";

import {
  ArrowRightLeft,
  FlaskConical,
  Lock,
  MapPin,
  Microscope,
  ScanLine,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./motion";

const FEED_MS = 3600;

type FeedKey = "move" | "hold" | "stage" | "derive" | "scan";
type FeedItem = {
  key: FeedKey;
  icon: LucideIcon;
  unit: "minutes" | "hours";
  count: number;
  alert?: boolean;
};

const FEED: readonly FeedItem[] = [
  { key: "move", icon: ArrowRightLeft, unit: "minutes", count: 2 },
  { key: "hold", icon: Lock, unit: "minutes", count: 18, alert: true },
  { key: "stage", icon: Sprout, unit: "hours", count: 1 },
  { key: "derive", icon: Microscope, unit: "hours", count: 2 },
  { key: "scan", icon: ScanLine, unit: "hours", count: 3 },
];

const SEGMENTS = [
  { key: "process", count: 12, bar: "bg-success-solid" },
  { key: "conditioning", count: 8, bar: "bg-warning-solid" },
  { key: "culture", count: 5, bar: "bg-accent" },
] as const;

/**
 * A picture of the product, not the product: every figure is an example and nothing here reads
 * data. It is described once as an image (`aria-label`), so assistive technology gets one clear
 * sentence instead of a feed of made-up events. The highlighted row advances every few seconds, and
 * only for visitors who have not asked for reduced motion.
 */
export function ProductDemo() {
  const t = useTranslations("marketing.demo");
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      if (!document.hidden) setCurrent((index) => (index + 1) % FEED.length);
    }, FEED_MS);
    return () => clearInterval(id);
  }, [reduced]);

  const highlighted = reduced ? -1 : current;

  return (
    <div
      role="img"
      aria-label={t("label")}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border bg-sunken px-4 py-3">
        <div aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-danger-solid/70" />
          <span className="size-2.5 rounded-full bg-warning-solid/70" />
          <span className="size-2.5 rounded-full bg-success-solid/70" />
        </div>
        <span className="ms-2 font-mono text-xs text-fg-secondary">{t("address")}</span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-5">
        <div className="flex flex-col gap-3 lg:col-span-3">
          <div className="rounded-xl border border-border bg-bg p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <FlaskConical aria-hidden="true" className="size-4 text-accent-text" />
                <span className="font-mono text-sm font-semibold text-accent-text">
                  {t("experimentCode")}
                </span>
              </span>
              <span className="rounded-full border border-accent-soft-border bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text">
                {t("active")}
              </span>
            </div>
            <p className="font-semibold">{t("experimentName")}</p>
            <p className="mt-1 text-xs text-fg-secondary">{t("experimentMeta")}</p>

            <div
              aria-hidden="true"
              className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-sunken"
            >
              {SEGMENTS.map((segment) => (
                <span
                  key={segment.key}
                  className={segment.bar}
                  style={{ width: `${(segment.count / 25) * 100}%` }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
              {SEGMENTS.map((segment) => (
                <li key={segment.key} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn("size-2 rounded-full", segment.bar)} />
                  {t(`segments.${segment.key}`)} · {segment.count}
                </li>
              ))}
            </ul>
          </div>

          <dl className="grid grid-cols-3 gap-2">
            {(
              [
                ["units", "25", false],
                ["rooms", "3", false],
                ["hold", "1", true],
              ] as const
            ).map(([key, value, alert]) => (
              <div
                key={key}
                className="rounded-lg border border-border bg-sunken px-3 py-2 text-center"
              >
                <dd className={cn("text-lg font-bold", alert ? "text-warning" : "text-fg")}>
                  {value}
                </dd>
                <dt className="text-[0.75rem] leading-4 text-fg-secondary">
                  {t(`stats.${key}`)}
                </dt>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:col-span-2">
          <p className="mb-2 text-xs font-semibold tracking-wide text-fg-secondary uppercase">
            {t("feedTitle")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {FEED.map((item, index) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.key}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors duration-500 motion-reduce:transition-none",
                    index === highlighted
                      ? "border-accent-soft-border bg-accent-soft"
                      : "border-transparent",
                    item.alert && "text-warning"
                  )}
                >
                  <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className={cn("block text-xs leading-snug", !item.alert && "text-fg")}>
                      {t(`feed.${item.key}`)}
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] text-fg-secondary">
                      {t(`ago.${item.unit}`, { count: item.count })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-border bg-sunken px-4 py-2 text-[0.75rem] text-fg-secondary">
        <MapPin aria-hidden="true" className="size-3" />
        {t("room")}
      </div>
    </div>
  );
}
