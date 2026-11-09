"use client";

import { BrandLogoLink } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";
import { PaletteTrigger } from "./CommandPalette";
import { SidebarAccount } from "./SidebarAccount";
import { SidebarNav } from "./SidebarNav";
import { SidebarTools } from "./SidebarTools";

/**
 * The whole sidebar as one column: brand and search at the top, every page in the middle, the account
 * at the bottom. In the `fixed` desktop sidebar the page list scrolls on its own when it is taller
 * than the screen, without a scrollbar: it fades out at the bottom edge while there is more. Brand,
 * language, theme and account never move. In the mobile `drawer` the drawer itself scrolls and
 * language and theme sit under the account. `onNavigate` closes the drawer after a choice.
 */
export function Sidebar({
  user,
  showCompliance,
  isAdmin = false,
  variant = "fixed",
  onSearch,
  onNavigate,
}: {
  user: { name: string; permissions: string };
  showCompliance: boolean;
  isAdmin?: boolean;
  variant?: "fixed" | "drawer";
  onSearch: () => void;
  onNavigate?: () => void;
}) {
  const fixed = variant === "fixed";
  return (
    <div className={cn("flex flex-col", fixed ? "h-full min-h-0" : "gap-6")}>
      <div className={cn("space-y-4", fixed && "px-4 pt-5 pb-4")}>
        {fixed ? (
          <div className="flex items-center justify-between gap-2">
            <BrandLogoLink />
            <SidebarTools />
          </div>
        ) : (
          <BrandLogoLink />
        )}
        <PaletteTrigger onClick={onSearch} />
      </div>
      <div
        className={cn(
          fixed &&
            "no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-6 mask-[linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
        )}
      >
        <SidebarNav showCompliance={showCompliance} isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
      <div
        className={cn(
          "space-y-3 border-t border-border",
          fixed ? "bg-sunken/50 px-3 py-3" : "pt-4"
        )}
      >
        <SidebarAccount name={user.name} role={user.permissions} onNavigate={onNavigate} />
        {fixed ? null : <SidebarTools />}
      </div>
    </div>
  );
}
