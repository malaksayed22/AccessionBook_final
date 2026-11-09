"use client";

import { Menu as MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLogoLink } from "@/components/BrandLogo";
import { IconButton } from "@/components/ui/IconButton";
import { Sheet } from "@/components/ui/Sheet";
import { Toaster } from "@/components/ui/Toast";
import { CommandPalette, PaletteTrigger } from "./CommandPalette";
import type { NavTabKey } from "./nav-config";
import { ReauthProvider } from "./ReauthProvider";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./Sidebar";
import { canReadCompliance, type Role } from "@/lib/roles";

/**
 * The authenticated frame: a sidebar that lists every page, and the page beside it. From `lg` up the
 * sidebar is fixed to the left edge and scrolls on its own; on narrower screens it becomes a drawer
 * opened from a slim top bar. `#main` is the skip-link target.
 */
export function AppShell({
  user,
  hiddenTabs = [],
  children,
}: {
  user: { name: string; permissions: string };
  /** Tabs of modules the lab has switched off. */
  hiddenTabs?: readonly NavTabKey[];
  children: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The compliance pages (reports, audit trail) are for admins, quality assurance and inspectors.
  const showCompliance = canReadCompliance({ permissions: user.permissions as Role });
  const isAdmin = user.permissions === "ADMIN";

  const openSearch = () => {
    setDrawerOpen(false);
    setPaletteOpen(true);
  };

  return (
    <ShellProvider value={{ showCompliance, hiddenTabs }}>
      <div className="min-h-screen bg-bg lg:flex">
        <aside
          aria-label={t("sidebar.label")}
          className="app-chrome sticky top-0 hidden h-dvh w-(--sidebar-width) shrink-0 border-e border-border bg-sidebar lg:block print:hidden"
        >
          <Sidebar
            user={user}
            showCompliance={showCompliance}
            isAdmin={isAdmin}
            onSearch={openSearch}
          />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="app-chrome sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-xl lg:hidden print:hidden">
            <Sheet
              side="left"
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              trigger={
                <IconButton label={t("topbar.openNavigation")}>
                  <MenuIcon className="size-5" />
                </IconButton>
              }
              title={t("topbar.mobileNavigationTitle")}
              description={t("topbar.mobileNavigationDescription")}
              hideTitle
            >
              <Sidebar
                user={user}
                showCompliance={showCompliance}
                isAdmin={isAdmin}
                variant="drawer"
                onSearch={openSearch}
                onNavigate={() => setDrawerOpen(false)}
              />
            </Sheet>
            <BrandLogoLink />
            <div className="ms-auto">
              <PaletteTrigger variant="icon" onClick={openSearch} />
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-(--content-max) flex-1 px-4 pt-8 pb-20 outline-none sm:px-8 lg:pt-10 print:max-w-none print:p-0"
          >
            {children}
            <p className="mt-16 text-xs text-fg-tertiary print:hidden">{t("footer.tagline")}</p>
          </main>
        </div>
      </div>
      <Toaster />
      <ReauthProvider />
      <CommandPalette
        showCompliance={showCompliance}
        isAdmin={isAdmin}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
    </ShellProvider>
  );
}
