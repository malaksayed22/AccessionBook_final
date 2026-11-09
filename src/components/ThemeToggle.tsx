"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

const MODES = [
  { mode: "light", Icon: Sun },
  { mode: "dark", Icon: Moon },
] as const;

/**
 * Light or dark, nothing in between. A visitor who never chose still follows the operating system
 * until the first click, which then pins the opposite of what is on screen.
 */
export function ThemeToggle({ compact, className }: { compact?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme();
  const t = useTranslations("shell.theme");

  if (compact) {
    // One button. Both icons are in the markup and CSS shows the one for the theme in effect, so the
    // server and the browser agree even while the theme is following the operating system.
    const toggle = () => {
      const showingDark =
        theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : theme === "dark";
      setTheme(showingDark ? "light" : "dark");
    };
    return (
      <button
        type="button"
        onClick={toggle}
        className={cn("rounded-lg p-2 text-fg-secondary hover:bg-hover hover:text-fg", className)}
        title={t("label")}
        aria-label={t("label")}
      >
        <Sun className="show-on-light size-4" aria-hidden />
        <Moon className="show-on-dark size-4" aria-hidden />
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
      role="group"
      aria-label={t("label")}
    >
      {MODES.map(({ mode, Icon }) => (
        <button
          key={mode}
          type="button"
          onClick={() => setTheme(mode)}
          aria-pressed={theme === mode}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            theme === mode
              ? "bg-accent text-on-accent"
              : "text-fg-secondary hover:bg-hover hover:text-fg"
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {t(mode)}
        </button>
      ))}
    </div>
  );
}
