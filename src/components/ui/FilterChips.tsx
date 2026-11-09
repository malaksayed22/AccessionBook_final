"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./DropdownMenu";
import { focusRing } from "./styles";

/*
 * Usage (filters live in the URL):
 *   <FilterChips
 *     label="Status"
 *     chips={[{ key: "active", label: "Active", count: 12, active: status === "active", href: toggleHref("active") }]}
 *     clearHref="/inventory/units"
 *   />
 *
 * One filter group, drawn as a quiet text trigger ("Status ⌄") that opens a short list. When an
 * option is chosen the trigger names it and is underlined, so the state reads without opening the
 * list and never relies on colour alone. Each option is a link whose `href` is the URL with that
 * filter toggled (the chosen one links to the URL without it, and carries aria-current="true"), so
 * the URL stays the state. "Clear all" sits at the foot of the list while any option is active.
 * A group with a single option is not worth a list: it is drawn as one toggle link instead.
 * Put several groups side by side in a <FilterBar>. The list uses Radix, so arrow keys, type-ahead,
 * Esc and focus return come for free.
 */
export type FilterChip = {
  key: string;
  label: string;
  href: string;
  active: boolean;
  count?: number;
};

export type FilterChipsProps = {
  chips: FilterChip[];
  /** URL with every filter removed; enables the "Clear all" item. */
  clearHref?: string;
  /** Name of the group, shown on the trigger; defaults to "Filters". */
  label?: string;
  className?: string;
};

const triggerBase =
  "relative inline-flex min-h-10 items-center gap-1.5 px-1 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11 " +
  "after:absolute after:inset-x-1 after:bottom-1.5 after:h-0.5 after:rounded-full after:transition-colors motion-reduce:after:transition-none";

export function FilterChips({ chips, clearHref, label, className }: FilterChipsProps) {
  const t = useTranslations("ui");
  const name = label ?? t("filters.label");
  const chosen = chips.filter((chip) => chip.active);
  const anyActive = chosen.length > 0;
  const tone = anyActive
    ? "text-fg after:bg-accent-text"
    : "text-fg-secondary after:bg-transparent hover:text-fg hover:after:bg-border-strong";

  const [only] = chips;
  if (chips.length === 1 && only) {
    return (
      <div role="group" aria-label={name} className={className}>
        <Link
          href={only.href}
          // A filter changes the list in place: the page keeps its scroll position.
          scroll={false}
          aria-current={only.active ? "true" : undefined}
          className={cn(triggerBase, tone, focusRing)}
        >
          {only.active ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          <span className="wrap-break-word">{only.label}</span>
        </Link>
      </div>
    );
  }

  return (
    <div role="group" aria-label={name} className={className}>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className={cn(triggerBase, tone, "group/trigger", focusRing)}>
            <span>{name}</span>
            {anyActive ? (
              <span className="font-normal text-accent-text">
                <span aria-hidden="true">{": "}</span>
                <span className="sr-only">{", "}</span>
                {chosen.map((chip) => chip.label).join(", ")}
              </span>
            ) : null}
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-fg-tertiary transition-transform duration-150 group-data-[state=open]/trigger:rotate-180 motion-reduce:transition-none"
            />
          </button>
        </MenuTrigger>
        <MenuContent align="center" className="min-w-56">
          {chips.map((chip) => (
            <MenuItem key={chip.key} asChild>
              <Link
                href={chip.href}
                scroll={false}
                aria-current={chip.active ? "true" : undefined}
                className={cn("justify-between gap-4", chip.active && "font-medium")}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-accent-text",
                      chip.active ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="wrap-break-word">{chip.label}</span>
                </span>
                {chip.count === undefined ? null : (
                  <span className="text-fg-tertiary tabular-nums">{chip.count}</span>
                )}
              </Link>
            </MenuItem>
          ))}
          {anyActive && clearHref ? (
            <>
              <MenuSeparator />
              <MenuItem asChild>
                <Link href={clearHref} className="text-fg-secondary">
                  <span className="ps-6">{t("filters.clearAll")}</span>
                </Link>
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>
    </div>
  );
}
