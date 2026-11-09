"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/DropdownMenu";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const iconButton =
  "flex size-9 items-center justify-center rounded-lg border border-transparent text-fg-secondary transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none pointer-coarse:size-11";

/**
 * Language and colour theme as two quiet icon buttons: the language opens a short menu, the theme
 * flips between light and dark. Stays on the same page and keeps the query string when the language
 * changes.
 */
export function SidebarTools({
  className,
  menuAlign = "start",
}: {
  className?: string;
  menuAlign?: "start" | "end";
}) {
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
    <div className={cn("flex items-center gap-0.5", className)}>
      <NotificationBell className={iconButton} />
      <Menu>
        <MenuTrigger className={iconButton} aria-label={t("label")} title={t("label")}>
          <Languages className="size-4" aria-hidden />
        </MenuTrigger>
        <MenuContent align={menuAlign} side="bottom">
          {routing.locales.map((code) => (
            <MenuItem
              key={code}
              lang={code}
              onSelect={() => switchTo(code)}
              icon={code === locale ? <Check /> : <span className="size-4" />}
            >
              {names(code)}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <ThemeToggle compact className={cn(iconButton, "p-0")} />
    </div>
  );
}
