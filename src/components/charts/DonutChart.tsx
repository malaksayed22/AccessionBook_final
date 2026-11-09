"use client";

import { useFormatter } from "next-intl";
import { useId, useState, type CSSProperties } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { glow, type Gradient } from "./palette";

/*
 * Usage:
 *   <DonutChart
 *     label="Units by type"
 *     centerValue="16"
 *     centerLabel="units"
 *     slices={[{ key: "PLANT", label: "Plants", value: 9, gradient: GRADIENTS.indigo, href: "/inventory/units?type=PLANT" }]}
 *   />
 * A ring of rounded, gradient segments with its legend beside it. Hover or focus a legend row (or a
 * segment) and that segment lifts while the rest dim and the centre shows its figure. The ring is
 * decoration: the legend prints every name, count and share, so nothing depends on seeing colour.
 */
export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  gradient: Gradient;
  /** A short line under the legend label (a location's capacity, say). */
  note?: string;
  /** Makes the legend entry a link to the matching filtered list. */
  href?: string;
};

const RADIUS = 15.9155; // circumference 100, so a slice's length is its percentage
const STROKE = 4.4;
/** Round caps add half the stroke at each end, so neighbours need more than a stroke of room. */
const GAP = STROKE + 1.2;

export function DonutChart({
  label,
  slices,
  centerValue,
  centerLabel,
  className,
}: {
  /** Accessible name of the chart. */
  label: string;
  slices: DonutSlice[];
  centerValue: string;
  centerLabel: string;
  className?: string;
}) {
  const format = useFormatter();
  const uid = useId().replace(/:/g, "");
  const [active, setActive] = useState<string | null>(null);

  const shown = slices.filter((slice) => slice.value > 0);
  const total = shown.reduce((sum, slice) => sum + slice.value, 0);
  const gap = shown.length > 1 ? GAP : 0;
  const segments = shown.map((slice, index) => {
    const before = shown.slice(0, index).reduce((sum, previous) => sum + previous.value, 0);
    return {
      ...slice,
      length: Math.max((slice.value / total) * 100 - gap, 0.1),
      offset: -((before / total) * 100 + gap / 2),
    };
  });
  const focused = slices.find((slice) => slice.key === active);

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-col items-center gap-6 sm:flex-row", className)}
    >
      <div className="relative size-44 shrink-0">
        <svg
          viewBox="0 0 42 42"
          aria-hidden="true"
          className="size-full -rotate-90 overflow-visible"
        >
          <defs>
            {segments.map((segment) => (
              <linearGradient
                key={segment.key}
                id={`${uid}-${segment.key}`}
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0" style={{ stopColor: segment.gradient[0] }} />
                <stop offset="1" style={{ stopColor: segment.gradient[1] }} />
              </linearGradient>
            ))}
          </defs>
          <circle
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-sunken"
          />
          {segments.map((segment, index) => {
            const on = active === segment.key;
            return (
              <circle
                key={segment.key}
                cx="21"
                cy="21"
                r={RADIUS}
                fill="none"
                strokeLinecap="round"
                strokeWidth={on ? STROKE + 1.1 : STROKE}
                pathLength={100}
                strokeDasharray={`${segment.length} ${100 - segment.length}`}
                strokeDashoffset={segment.offset}
                stroke={`url(#${uid}-${segment.key})`}
                className="ring-in"
                onPointerEnter={() => setActive(segment.key)}
                onPointerLeave={() => setActive(null)}
                style={
                  {
                    "--i": index,
                    opacity: active && !on ? 0.28 : 1,
                    filter: on ? `drop-shadow(0 0 1.6px ${glow(segment.gradient[1], 85)})` : "none",
                    transition: "opacity 200ms, stroke-width 200ms, filter 200ms",
                  } as CSSProperties
                }
              >
                <title>{`${segment.label}: ${format.number(segment.value, "count")}`}</title>
              </circle>
            );
          })}
        </svg>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
        >
          <span className="font-serif text-[2.5rem] leading-none font-normal tracking-[-0.02em] text-fg tabular-nums">
            {focused ? format.number(focused.value, "count") : centerValue}
          </span>
          <span className="mt-1.5 max-w-full truncate text-xs text-fg-secondary">
            {focused ? focused.label : centerLabel}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-0.5">
        {slices.map((slice) => (
          <li
            key={slice.key}
            onPointerEnter={() => setActive(slice.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(slice.key)}
            onBlur={() => setActive(null)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors motion-reduce:transition-none",
              active === slice.key && "bg-hover"
            )}
          >
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{
                background: `linear-gradient(135deg, ${slice.gradient[0]}, ${slice.gradient[1]})`,
                boxShadow: `0 0 10px -1px ${glow(slice.gradient[1], 60)}`,
              }}
            />
            <span className="min-w-0 flex-1 wrap-break-word">
              {slice.href ? (
                <Link href={slice.href} className="font-medium text-accent-text hover:underline">
                  {slice.label}
                </Link>
              ) : (
                <span className="font-medium text-fg">{slice.label}</span>
              )}
              {slice.note ? (
                <span className="block text-xs text-fg-secondary">{slice.note}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-fg">{format.number(slice.value, "count")}</span>
              {total > 0 ? (
                <span className="ms-2 inline-block min-w-12 text-end text-fg-secondary">
                  {format.number(slice.value / total, "percent")}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
