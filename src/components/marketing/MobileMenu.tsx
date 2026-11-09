"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type MouseEvent } from "react";
import { SidebarTools } from "@/components/shell/SidebarTools";
import { IconButton } from "@/components/ui/IconButton";
import { Sheet } from "@/components/ui/Sheet";
import { REDUCED_MOTION_QUERY } from "./gsap";
import { PillLink } from "./PillLink";

/** Time for the drawer to finish sliding out before the page scrolls, so the two never fight. */
const CLOSE_MS = 220;

type Props = {
  sections: ReadonlyArray<{ id: string; label: string }>;
  entryHref: string;
  entryLabel: string;
};

/**
 * The page's section links, language and theme for phones, where the inline nav has no room. A
 * right-hand drawer (focus trap, Esc, scroll lock and focus restore come from Sheet). Choosing a
 * section closes the drawer first and then scrolls, because the open drawer locks page scrolling.
 */
export function MobileMenu({ sections, entryHref, entryLabel }: Props) {
  const t = useTranslations("marketing.header");
  const [open, setOpen] = useState(false);

  const goTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    setOpen(false);
    window.setTimeout(() => {
      const behavior = window.matchMedia(REDUCED_MOTION_QUERY).matches ? "auto" : "smooth";
      document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
    }, CLOSE_MS);
  };

  return (
    <Sheet
      side="right"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton label={t("menu")} className="md:hidden">
          <Menu />
        </IconButton>
      }
      title={t("menuTitle")}
      description={t("menuDescription")}
      hideTitle
    >
      <div className="flex min-h-full flex-col">
        <nav aria-label={t("navLabel")} className="-mx-1 pt-8">
          <ul className="divide-y divide-border border-y border-border">
            {sections.map(({ id, label }, index) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  onClick={(event) => goTo(event, id)}
                  className="group flex min-h-14 items-center gap-4 rounded-lg px-1 text-lg font-medium tracking-tight text-fg transition-colors active:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus motion-reduce:transition-none"
                >
                  <span
                    aria-hidden="true"
                    className="w-6 font-mono text-xs tracking-wider text-fg-tertiary group-active:text-accent-text"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto space-y-5 pt-8 pb-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-fg-secondary">{t("preferences")}</span>
            <SidebarTools menuAlign="end" />
          </div>
          <PillLink href={entryHref} size="lg" className="w-full">
            {entryLabel}
          </PillLink>
        </div>
      </div>
    </Sheet>
  );
}
