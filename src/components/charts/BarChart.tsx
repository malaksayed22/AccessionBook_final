import { useFormatter } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CYCLE, glow, type Gradient } from "./palette";

/*
 * Usage:
 *   <BarChart label="Units by stage" items={[{ key: "FLOWERING", label: "Flowering", value: 6 }]} />
 *   <BarChart label="Locations" items={[{ key: "1", label: "Vault A", value: 31, max: 40, note: "of 40" }]} />
 * Horizontal bars, one row per item, every row printing its name and figure as text. Bars share one
 * scale (the largest value) unless a row has its own `max`, e.g. a room's capacity, in which case the
 * bar shows how full it is. Without a `gradient` the rows take the chart colours in turn. Server
 * friendly; the bars draw themselves with `.grow-x`.
 */
export type BarItem = {
  key: string;
  label: ReactNode;
  value: number;
  /** Full scale for this row (a capacity). Without it the row is scaled against the largest value. */
  max?: number | null;
  /** Text after the value, e.g. "of 40". */
  note?: ReactNode;
  href?: string;
  gradient?: Gradient;
};

export function BarChart({
  label,
  items,
  className,
}: {
  /** Accessible name of the list. */
  label: string;
  items: BarItem[];
  className?: string;
}) {
  const format = useFormatter();
  const widest = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul aria-label={label} className={cn("space-y-4", className)}>
      {items.map((item, index) => {
        const scale = item.max && item.max > 0 ? item.max : widest;
        const fill = Math.min(100, Math.max(item.value > 0 ? 3 : 0, (item.value / scale) * 100));
        const [from, to] = item.gradient ?? CYCLE[index % CYCLE.length]!;
        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 wrap-break-word">
                {item.href ? (
                  <Link href={item.href} className="font-medium text-accent-text hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="font-medium text-fg">{item.label}</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold text-fg">{format.number(item.value, "count")}</span>
                {item.note ? <span className="ms-1.5 text-fg-secondary">{item.note}</span> : null}
              </span>
            </div>
            <div aria-hidden="true" className="mt-2 h-2 rounded-full bg-sunken">
              <div
                className="grow-x h-full rounded-full"
                style={
                  {
                    width: `${fill}%`,
                    background: `linear-gradient(90deg, ${from}, ${to})`,
                    boxShadow: `0 2px 12px -2px ${glow(to, 55)}`,
                    "--i": Math.min(index, 10),
                  } as CSSProperties
                }
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
