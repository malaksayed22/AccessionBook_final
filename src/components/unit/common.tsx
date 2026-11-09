import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EntityLink } from "@/components/page/EntityLink";
import { cn } from "@/lib/utils";

/*
 * Small pieces shared by the unit page panels. They use next-intl hooks, so they render the same on
 * the server and in the browser: dates carry the laboratory time zone, weights are grams.
 */

/** An instant with its time zone shown ("Oct 24, 2026, 2:15 p.m. EDT") and a machine-readable value. */
export function When({ value, className }: { value: Date | string | null; className?: string }) {
  const format = useFormatter();
  const domain = useTranslations("domain");
  if (value === null) return <span className={className}>{domain("empty")}</span>;
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()} className={cn("tabular-nums", className)}>
      {format.dateTime(date, "dateTime")}
    </time>
  );
}

/** A calendar day (no time of day). */
export function Day({ value }: { value: Date | string | null }) {
  const format = useFormatter();
  const domain = useTranslations("domain");
  if (value === null) return <>{domain("empty")}</>;
  const date = typeof value === "string" ? new Date(value) : value;
  return <time dateTime={date.toISOString()}>{format.dateTime(date, "date")}</time>;
}

/** Grams to the milligram, or the empty mark. */
export function Grams({ value }: { value: number | null }) {
  const format = useFormatter();
  const domain = useTranslations("domain");
  return <>{value === null ? domain("empty") : format.number(value, "grams")}</>;
}

/** A definition list laid out as label / value rows. */
export function FactList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid gap-x-6 gap-y-5 sm:grid-cols-2", className)}>{children}</dl>;
}

export function Fact({
  label,
  children,
  wide = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Spans both columns (long text). */
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium wrap-break-word text-fg">{children}</dd>
    </div>
  );
}

/** Who did it, then when: the pair every history row shows. `whoId` makes the name a link to the member. */
export function Stamp({
  who,
  whoId,
  at,
}: {
  who: string | null;
  whoId?: number | null;
  at: Date | string;
}) {
  const domain = useTranslations("domain");
  return (
    <span className="flex flex-col">
      <When value={at} />
      <span className="text-fg-secondary">
        {who ? (
          <EntityLink kind="member" id={whoId} className="font-normal">
            {who}
          </EntityLink>
        ) : (
          domain("empty")
        )}
      </span>
    </span>
  );
}

/** Styling for in-text links to other records. */
export const linkClass =
  "rounded-sm text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
