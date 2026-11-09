import { LayoutGrid, List, Table2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buildListUrl } from "@/lib/list-params";
import { cn } from "@/lib/utils";

/*
 * Usage (server component; the view lives in the URL as ?view=):
 *   <ViewModeToggle basePath="/inventory/experiments" params={{ q, status }} activeView={view} />
 *
 * Two links, cards and table, set as plain text with a small icon: no box around them. The active
 * one is darker, underlined and has aria-current; the label is always visible text. Put it in the
 * list's <FilterBar controls>, beside the search, since it changes how the list is drawn, not the
 * page. Switching view returns to the first page.
 */
const ICONS: Record<ViewMode, LucideIcon> = { cards: LayoutGrid, list: List, table: Table2 };

export type ViewMode = "cards" | "list" | "table";
export const DEFAULT_VIEW: ViewMode = "cards";

/** The view named in a URL parameter, or the default. */
export function parseViewMode(
  value: string | undefined,
  allowed: readonly ViewMode[] = ["cards", "table"]
): ViewMode {
  return allowed.find((mode) => mode === value) ?? DEFAULT_VIEW;
}

export function ViewModeToggle({
  basePath,
  params,
  activeView = DEFAULT_VIEW,
  modes = ["cards", "table"],
}: {
  basePath: string;
  params: Record<string, string | number | undefined | null>;
  activeView?: string;
  modes?: readonly ViewMode[];
}) {
  const t = useTranslations("experiments.view");
  const view = parseViewMode(activeView, modes);

  return (
    <nav aria-label={t("label")}>
      <ul className="flex items-center gap-6">
        {modes.map((mode) => {
          const Icon = ICONS[mode];
          const active = view === mode;
          return (
            <li key={mode}>
              <Link
                href={buildListUrl(basePath, params, {
                  view: mode === DEFAULT_VIEW ? undefined : mode,
                  page: undefined,
                })}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "relative inline-flex min-h-10 items-center gap-1.5 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11",
                  "after:absolute after:inset-x-0 after:bottom-1 after:h-0.5 after:rounded-full after:transition-colors motion-reduce:after:transition-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  active
                    ? "text-fg after:bg-accent-text"
                    : "text-fg-secondary after:bg-transparent hover:text-fg hover:after:bg-border-strong"
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {t(mode)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
