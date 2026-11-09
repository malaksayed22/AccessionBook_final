"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/IconButton";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/roles";

/** The bottom of the sidebar: who is signed in (a link to the profile page) and sign out. */
export function SidebarAccount({
  name,
  role,
  onNavigate,
}: {
  name: string;
  /** The person's role, as stored (`ADMIN`, `REGULAR`, `QA`, …). */
  role: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("shell.user");
  const domain = useTranslations("domain");
  const router = useRouter();
  const onProfile = usePathname() === "/profile";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          href="/profile"
          onClick={onNavigate}
          aria-label={t("openProfile", { name })}
          aria-current={onProfile ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            onProfile ? "bg-accent-soft" : "hover:bg-hover"
          )}
        >
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent"
          >
            {initialsOf(name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">{name}</span>
            <span className="block truncate text-xs text-fg-secondary">
              {domain(`role.${role as Role}`)}
            </span>
          </span>
        </Link>
        <IconButton label={t("signOut")} onClick={signOut}>
          <LogOut className="size-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
