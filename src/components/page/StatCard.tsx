import { ArrowUpRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/*
 * Usage: <StatCard label="Units on hold" value={3} hint="Cannot move until released" href="/quality" tone="warning" />
 * One headline number with its meaning. With `href` the whole card is a link (the label is the link
 * text) and an arrow appears on hover. `tone` colours only a small dot beside the label; the label
 * and hint always say what the number means, so colour is never the only signal. Pass `index` to
 * make a row of cards rise in one after another. `selected` marks the card whose filter is on (a link
 * to the same list with that filter): it gets a stronger border and `aria-current`.
 */
export type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
  /** The filter this card links to is the one currently applied. */
  selected?: boolean;
  /** Position in a row of cards, for the staggered entrance. */
  index?: number;
  className?: string;
};

const DOT: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-fg-tertiary ring-neutral-soft",
  warning: "bg-warning-solid ring-warning-soft",
  danger: "bg-danger-solid ring-danger-soft",
  success: "bg-success-solid ring-success-soft",
};

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
  selected = false,
  index,
  className,
}: StatCardProps) {
  const body = (
    <>
      <span className="flex items-center gap-2.5 text-sm font-medium text-fg-secondary">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full ring-4", DOT[tone])} />
        <span className="min-w-0 text-pretty">{label}</span>
      </span>
      <span className="mt-5 block font-serif text-5xl leading-none font-normal tracking-[-0.02em] text-fg tabular-nums">
        {value}
      </span>
      {hint ? (
        <span className="mt-4 block text-sm text-pretty text-fg-secondary">{hint}</span>
      ) : null}
      {href ? (
        <ArrowUpRight
          aria-hidden
          className="absolute end-5 top-5 size-4 text-fg-tertiary opacity-0 transition-[opacity,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
      ) : null}
    </>
  );
  const shared = cn(
    "group relative block rounded-xl border bg-surface p-5 shadow-sm sm:p-6",
    selected ? "border-accent-text ring-1 ring-accent-text" : "border-border",
    index !== undefined && "rise",
    className
  );
  const style = index !== undefined ? ({ "--i": index } as CSSProperties) : undefined;

  return href ? (
    <Link
      href={href}
      style={style}
      aria-current={selected ? "true" : undefined}
      className={cn(
        shared,
        "transition-colors duration-150 hover:border-border-strong hover:bg-hover motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      )}
    >
      {body}
    </Link>
  ) : (
    <div style={style} className={shared}>
      {body}
    </div>
  );
}
