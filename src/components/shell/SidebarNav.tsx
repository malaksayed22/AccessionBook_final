"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isActivePath, tabForPath, visibleHubs, type NavHub, type NavTab } from "./nav-config";
import { useShell } from "./shell-context";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type ItemProps = {
  href: string;
  label: string;
  icon: NavTab["icon"] | NavHub["icon"];
  active: boolean;
  exact: boolean;
  onNavigate?: () => void;
};

/** One page in the sidebar. `aria-current` is `page` on the page itself and `true` on a record inside it. */
function SidebarItem({ href, label, icon: Icon, active, exact, onNavigate }: ItemProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? (exact ? "page" : "true") : undefined}
      className={cn(
        "group relative flex min-h-8 items-center gap-3 rounded-lg px-3 py-1 text-sm font-medium transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
        active
          ? "bg-accent-soft text-accent-text"
          : "text-fg-secondary hover:bg-hover hover:text-fg",
        focus
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-accent-text"
        />
      ) : null}
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-accent-text" : "text-accent-text/60 group-hover:text-accent-text"
        )}
        aria-hidden
      />
      <span className="min-w-0 wrap-break-word">{label}</span>
    </Link>
  );
}

/**
 * Every page of the application as one list, grouped under the five hubs. Nothing is hidden behind a
 * menu or a second row of tabs: the page you are on is highlighted and the rest are one click away.
 * The same list fills the desktop sidebar and the mobile drawer; `onNavigate` closes the drawer.
 */
export function SidebarNav({
  showCompliance,
  isAdmin = false,
  onNavigate,
}: {
  showCompliance: boolean;
  isAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("shell.nav");
  const pathname = usePathname();
  const activeTab = tabForPath(pathname);
  const { hiddenTabs } = useShell();

  return (
    <nav aria-label={t("label")} className="space-y-4">
      {visibleHubs(showCompliance, isAdmin, hiddenTabs).map((hub) => {
        if (hub.tabs.length === 0) {
          const active = isActivePath(pathname, hub.base);
          return (
            <ul key={hub.key}>
              <li>
                <SidebarItem
                  href={hub.href}
                  label={t(`hubs.${hub.key}.label`)}
                  icon={hub.icon}
                  active={active}
                  exact={pathname === hub.href}
                  onNavigate={onNavigate}
                />
              </li>
            </ul>
          );
        }

        const headingId = `sidebar-group-${hub.key}`;
        return (
          <section key={hub.key} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="px-3 pb-1.5 font-mono text-xs tracking-[0.14em] text-accent-text/80 uppercase"
            >
              {t(`hubs.${hub.key}.label`)}
            </h2>
            <ul className="space-y-0.5">
              {hub.tabs.map((tab) => (
                <li key={tab.key}>
                  <SidebarItem
                    href={tab.href}
                    label={t(`tabs.${tab.key}.label`)}
                    icon={tab.icon}
                    active={activeTab?.key === tab.key}
                    exact={pathname === tab.href}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
