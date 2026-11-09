"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ActionGroup, ActionId } from "@/lib/action-catalog";
import { cn } from "@/lib/utils";
import { ACTION_ICONS, CATEGORY_ICONS } from "./icons";

/** The first step: every action the person may take here, grouped by what it does to the record. */
export function ActionMenu({
  groups,
  onChoose,
}: {
  groups: ActionGroup[];
  onChoose: (action: ActionId) => void;
}) {
  const t = useTranslations("actions");

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const CategoryIcon = CATEGORY_ICONS[group.category];
        const headingId = `action-group-${group.category}`;
        return (
          <section key={group.category} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-secondary uppercase"
            >
              <CategoryIcon aria-hidden="true" className="size-4" />
              {t(`categories.${group.category}`)}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.actions.map((action) => {
                const Icon = ACTION_ICONS[action.id];
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      onClick={() => onChoose(action.id)}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-start",
                        "transition-colors duration-150 hover:border-border-strong hover:bg-hover motion-reduce:transition-none",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      )}
                    >
                      <Icon aria-hidden="true" className="size-5 shrink-0 text-accent-text" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium wrap-break-word">
                          {t(`items.${action.id}.title`)}
                        </span>
                        <span className="block text-sm text-fg-secondary wrap-break-word">
                          {t(`items.${action.id}.description`)}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-fg-tertiary rtl:rotate-180"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
