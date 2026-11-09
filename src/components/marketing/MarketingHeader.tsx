import { getTranslations } from "next-intl/server";
import { BrandLogo } from "@/components/BrandLogo";
import { SidebarTools } from "@/components/shell/SidebarTools";
import { MobileMenu } from "@/components/marketing/MobileMenu";
import { PillLink } from "@/components/marketing/PillLink";
import { SOFT_TEXT } from "@/components/marketing/softText";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = ["platform", "compliance"] as const;

/**
 * The page banner: brand, section links, language, theme and the way in. A server component; the
 * client parts are the language and theme tools (shared with the app sidebar) and the phone menu,
 * which takes over from the inline links below `md`. It is fixed, so the controls stay reachable.
 */
export async function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("marketing.header");
  const entryHref = signedIn ? "/dashboard" : "/login";
  const entryLabel = signedIn ? t("openWorkspace") : t("signIn");

  return (
    <header className="scope-dark fixed inset-x-0 top-0 z-40 border-b border-border/60 bg-bg/80 text-fg backdrop-blur-xl supports-[backdrop-filter]:bg-bg/60">
      <div
        className={cn(
          "mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6",
          SOFT_TEXT
        )}
      >
        <Link
          href="/"
          aria-label={t("home")}
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          {/* On phones the badge alone leaves room for the sign-in link and the menu button. */}
          <BrandLogo size="sm" className="max-[479px]:[&_span.font-semibold]:hidden" />
        </Link>

        <nav aria-label={t("navLabel")} className="hidden items-center gap-6 text-sm md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section}
              href={`#${section}`}
              className="rounded-sm text-fg-secondary transition-colors hover:text-fg motion-reduce:transition-none"
            >
              {t(section)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <SidebarTools menuAlign="end" className="hidden md:flex" />
          <PillLink
            href={entryHref}
            variant="outline"
            size="sm"
            className="max-sm:px-3.5 max-sm:text-[0.8125rem]"
          >
            {entryLabel}
          </PillLink>
          <MobileMenu
            sections={SECTIONS.map((id) => ({ id, label: t(id) }))}
            entryHref={entryHref}
            entryLabel={entryLabel}
          />
        </div>
      </div>
    </header>
  );
}
