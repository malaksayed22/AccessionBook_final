import { useFormatter } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/*
 * Usage: <DistributionList label="Units by type" total={40} items={[{ key: "PLANT", label: "Plants", count: 25, href: "/inventory/units?type=PLANT" }]} />
 * A labelled bar chart that never relies on the bar: every row prints its name, its count and its
 * share as text, and the bars are decorative. Server-friendly; numbers go through the formatter.
 */
export type DistributionItem = {
  key: string;
  label: ReactNode;
  count: number;
  /** Makes the label a link to the matching filtered list. */
  href?: string;
  /** A secondary line under the label. */
  note?: ReactNode;
};

export function DistributionList({
  label,
  items,
  total,
  className,
}: {
  /** Accessible name of the list. */
  label: string;
  items: DistributionItem[];
  /** The whole the shares are taken of (not necessarily the sum of `items`). */
  total: number;
  className?: string;
}) {
  const format = useFormatter();
  const widest = Math.max(1, ...items.map((item) => item.count));

  return (
    <ul aria-label={label} className={cn("space-y-4", className)}>
      {items.map((item, index) => (
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
              {item.note ? <span className="block text-fg-secondary">{item.note}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-fg">{format.number(item.count, "count")}</span>
              {total > 0 ? (
                <span className="ms-1.5 text-fg-secondary">
                  {format.number(item.count / total, "percent")}
                </span>
              ) : null}
            </span>
          </div>
          <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="grow-x h-full rounded-full bg-accent"
              style={
                {
                  width: `${Math.max(2, (item.count / widest) * 100)}%`,
                  "--i": Math.min(index, 10),
                } as CSSProperties
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
