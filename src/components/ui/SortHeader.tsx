import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ariaSortFor, nextSortOrder, type SortOrder, type SortState } from "./sort";
import { focusRing, thBase } from "./styles";

/*
 * Usage inside a <thead><tr>:
 *   <SortHeader sortKey="name" current={{ sort, order }} buildHref={(s, o) => `/inventory/units?sort=${s}&order=${o}`}>
 *     Name
 *   </SortHeader>
 *
 * Renders the whole <th scope="col"> with `aria-sort` on the active column, containing a real
 * link to the same page with the next direction. State lives in the URL, so sorting works without
 * JavaScript, can be bookmarked, and is a normal server render. No "use client": usable in RSC.
 */
export type SortHeaderProps = {
  sortKey: string;
  current: SortState;
  /** Build the URL for sorting by `sort` in direction `order` (keep the other query params). */
  buildHref: (sort: string, order: SortOrder) => string;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
};

export function SortHeader({
  sortKey,
  current,
  buildHref,
  align = "start",
  className,
  children,
}: SortHeaderProps) {
  const t = useTranslations("ui");
  const next = nextSortOrder(current, sortKey);
  const active = current.sort === sortKey;
  const Icon = !active ? ChevronsUpDown : current.order === "desc" ? ArrowDown : ArrowUp;

  return (
    <th
      scope="col"
      aria-sort={ariaSortFor(current, sortKey)}
      className={cn(thBase, align === "end" && "text-right", className)}
    >
      <Link
        scroll={false}
        href={buildHref(sortKey, next)}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-sm hover:text-fg",
          active && "text-fg",
          focusRing
        )}
      >
        <span>{children}</span>
        <Icon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", active ? "text-fg" : "text-fg-tertiary")}
        />
        <span className="sr-only">
          , {next === "asc" ? t("sort.ascending") : t("sort.descending")}
        </span>
      </Link>
    </th>
  );
}
