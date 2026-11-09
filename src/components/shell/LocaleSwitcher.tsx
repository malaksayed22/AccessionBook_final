"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Language switch. Stays on the same page (and keeps the query string); next-intl rewrites the URL
 * prefix and remembers the choice in a cookie. Each button carries `lang` so screen readers
 * pronounce the language's own name correctly.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("shell.locale");
  const names = useTranslations("common.language");
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams().toString();

  function switchTo(next: AppLocale) {
    if (next === locale) return;
    router.replace(search ? `${pathname}?${search}` : pathname, { locale: next });
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5",
        className
      )}
    >
      {routing.locales.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            onClick={() => switchTo(code)}
            aria-pressed={active}
            aria-label={active ? names(code) : t("switchTo", { language: names(code) })}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
              active ? "bg-accent text-on-accent" : "text-fg-secondary hover:bg-hover hover:text-fg"
            )}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
