import { useFormatter } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CYCLE, type Gradient } from "./palette";

/*
 * Usage:
 *   <ProportionBar
 *     label="Units by type"
 *     segments={[{ key: "PLANT", label: "Plants", value: 8 }, { key: "SEEDLOT", label: "Seed lots", value: 2 }]}
 *   />
 * One bar cut into segments, each as wide as its share of the total, with a legend underneath that prints
 * every name and figure, so the bar never carries meaning by colour alone. Server friendly. Segments with
 * no units are left out; with nothing to show it renders the `empty` text instead.
 */
export type ProportionSegment = {
  key: string;
  label: ReactNode;
  value: number;
  gradient?: Gradient;
};

export function ProportionBar({
  label,
  segments,
  empty,
  className,
}: {
  /** Accessible name of the whole bar. */
  label: string;
  segments: ProportionSegment[];
  empty?: ReactNode;
  className?: string;
}) {
  const format = useFormatter();
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return empty ? <p className={cn("text-sm text-fg-secondary", className)}>{empty}</p> : null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="img"
        aria-label={`${label}: ${shown
          .map((segment) => `${segment.value} ${segment.label}`)
          .join(", ")}`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-sunken"
      >
        {shown.map((segment, index) => {
          const [from, to] = segment.gradient ?? CYCLE[index % CYCLE.length]!;
          return (
            <span
              key={segment.key}
              aria-hidden="true"
              className="h-full min-w-1.5 first:rounded-s-full last:rounded-e-full"
              style={{
                width: `${(segment.value / total) * 100}%`,
                background: `linear-gradient(135deg, ${from}, ${to})`,
              }}
            />
          );
        })}
      </div>
      <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shown.map((segment, index) => {
          const [from, to] = segment.gradient ?? CYCLE[index % CYCLE.length]!;
          return (
            <li key={segment.key} className="inline-flex items-center gap-1.5 text-fg-secondary">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
              />
              {segment.label}
              <span className="font-semibold text-fg tabular-nums">
                {format.number(segment.value, "count")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
