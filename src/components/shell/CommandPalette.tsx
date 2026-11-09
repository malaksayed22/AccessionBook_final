"use client";

import { Dna, FlaskConical, Microscope, Search, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useRouter } from "@/i18n/navigation";
import { useShortcutLabel } from "@/lib/use-shortcut-label";
import { cn } from "@/lib/utils";
import { visibleHubs } from "./nav-config";
import { useShell } from "./shell-context";

type Lookup = {
  units: Array<{
    id: number;
    name: string;
    type: string;
    cultivar: { name: string } | null;
    currentState: { location: { name: string } | null } | null;
  }>;
  experiments: Array<{ id: number; ecode: string; name: string }>;
  cultivars: Array<{ id: number; name: string }>;
};

type Option = {
  id: string;
  href: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: "pages" | "units" | "experiments" | "cultivars" | "search";
};

const EMPTY: Lookup = { units: [], experiments: [], cultivars: [] };

/**
 * Ctrl/⌘+K: jump to any page, or find a unit, experiment or cultivar. A combobox following the
 * ARIA pattern: focus stays in the input, arrow keys move the highlighted option
 * (`aria-activedescendant`), Enter opens it, Esc closes.
 */
export function PaletteTrigger({
  onClick,
  variant = "field",
}: {
  onClick: () => void;
  /** `field` fills its row (drawer), `pill` is the top bar's search, `icon` is the small-screen button. */
  variant?: "field" | "pill" | "icon";
}) {
  const t = useTranslations("shell.palette");
  const shortcut = useShortcutLabel();

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={t("open")}
        title={t("open")}
        className="inline-flex size-10 items-center justify-center rounded-lg text-fg-secondary transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none pointer-coarse:size-11"
      >
        <Search className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-10 w-full items-center gap-2 border-b border-border text-left text-sm text-fg-secondary transition-colors hover:border-fg-tertiary hover:text-fg focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-transparent motion-reduce:transition-none pointer-coarse:min-h-11",
        variant === "pill" ? "px-1" : "px-0.5"
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t("open")}</span>
      <kbd className="hidden shrink-0 font-mono text-[0.75rem] text-fg-tertiary sm:block">
        {shortcut}
      </kbd>
    </button>
  );
}

/** One instance per page; open it from `PaletteTrigger` buttons or with Ctrl/⌘+K. */
export function CommandPalette({
  showCompliance,
  isAdmin = false,
  open,
  onOpenChange,
}: {
  showCompliance: boolean;
  isAdmin?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shell.palette");
  const nav = useTranslations("shell.nav");
  const { hiddenTabs } = useShell();
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Lookup>(EMPTY);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const lookupToken = useRef(0);

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const close = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (!next) {
        setQuery("");
        setFound(EMPTY);
        setActive(0);
      }
    },
    [onOpenChange]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  // Debounced record lookup. A token discards answers that arrive after a newer keystroke.
  useEffect(() => {
    if (!open || trimmed.length < 2) return;
    const token = ++lookupToken.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/lookup?q=${encodeURIComponent(trimmed)}`);
        const data = res.ok ? ((await res.json()) as Lookup) : EMPTY;
        if (token === lookupToken.current) setFound(data);
      } catch {
        if (token === lookupToken.current) setFound(EMPTY);
      } finally {
        if (token === lookupToken.current) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [open, trimmed]);

  const options = useMemo<Option[]>(() => {
    const pages = visibleHubs(showCompliance, isAdmin, hiddenTabs)
      .flatMap((navHub) => {
        const hubLabel = nav(`hubs.${navHub.key}.label`);
        if (navHub.tabs.length === 0) {
          return [
            {
              id: `page-${navHub.key}`,
              href: navHub.href,
              label: hubLabel,
              hint: nav(`hubs.${navHub.key}.hint`),
              icon: navHub.icon,
              group: "pages" as const,
            },
          ];
        }
        return navHub.tabs.map((tab) => ({
          id: `page-${tab.key}`,
          href: tab.href,
          label: nav(`tabs.${tab.key}.label`),
          hint: `${hubLabel} · ${nav(`tabs.${tab.key}.hint`)}`,
          icon: tab.icon,
          group: "pages" as const,
        }));
      })
      .filter((o) => !needle || `${o.label} ${o.hint}`.toLowerCase().includes(needle));

    const records: Option[] =
      trimmed.length >= 2
        ? [
            ...found.units.map((u) => ({
              id: `unit-${u.id}`,
              href: `/inventory/units/${u.id}`,
              label: u.name,
              // Why it matched, at a glance: the cultivar and where it is.
              hint: [u.cultivar?.name, u.currentState?.location?.name].filter(Boolean).join(" · "),
              icon: Microscope,
              group: "units" as const,
            })),
            ...found.experiments.map((e) => ({
              id: `experiment-${e.id}`,
              href: `/inventory/experiments/${e.id}`,
              label: e.ecode,
              hint: e.name,
              icon: FlaskConical,
              group: "experiments" as const,
            })),
            ...found.cultivars.map((c) => ({
              id: `cultivar-${c.id}`,
              href: `/records/cultivars/${c.id}`,
              label: c.name,
              icon: Dna,
              group: "cultivars" as const,
            })),
          ]
        : [];

    const searchAll: Option[] =
      trimmed.length >= 2
        ? [
            {
              id: "search-all",
              href: `/search?q=${encodeURIComponent(trimmed)}`,
              label: t("searchFor", { query: trimmed }),
              icon: Search,
              group: "search",
            },
          ]
        : [];

    return [...pages, ...records, ...searchAll];
  }, [showCompliance, isAdmin, hiddenTabs, nav, t, needle, trimmed, found]);

  function choose(option: Option | undefined) {
    if (!option) return;
    close(false);
    router.push(option.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (options.length ? (i + 1) % options.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[active]);
    }
  }

  const activeOption = options[Math.min(active, options.length - 1)];
  const groups = (["pages", "units", "experiments", "cultivars", "search"] as const)
    .map((group) => ({ group, items: options.filter((o) => o.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={close}
        title={t("title")}
        hideTitle
        size="lg"
        className="p-0"
      >
        <div className="-m-1">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-fg-tertiary" aria-hidden />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
              aria-autocomplete="list"
              aria-label={t("title")}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t("placeholder")}
              className="min-h-12 w-full border-0 bg-transparent px-0 text-base shadow-none outline-none"
            />
          </div>

          <div
            id={listId}
            role="listbox"
            aria-label={t("title")}
            className="max-h-[50vh] overflow-y-auto py-2"
          >
            {groups.map(({ group, items }) => (
              <div key={group} role="group" aria-label={t(`groups.${group}`)}>
                <p
                  aria-hidden
                  className="px-4 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-tertiary uppercase"
                >
                  {t(`groups.${group}`)}
                </p>
                {items.map((option) => {
                  const selected = option.id === activeOption?.id;
                  return (
                    <div
                      key={option.id}
                      id={`${listId}-${option.id}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(options.indexOf(option))}
                      onClick={() => choose(option)}
                      className={cn(
                        "mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm",
                        selected ? "bg-accent-soft text-accent-text" : "text-fg"
                      )}
                    >
                      <option.icon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                      {option.hint && (
                        <span className="hidden max-w-[45%] truncate text-xs text-fg-secondary sm:block">
                          {option.hint}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div role="status" aria-live="polite" className="px-4 pb-1 text-sm text-fg-secondary">
            {searching ? t("searching") : null}
            {!searching && trimmed.length >= 2 && options.length === 1
              ? t("noResults", { query: trimmed })
              : null}
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-fg-tertiary">{t("hint")}</p>
        </div>
      </Dialog>
    </>
  );
}
