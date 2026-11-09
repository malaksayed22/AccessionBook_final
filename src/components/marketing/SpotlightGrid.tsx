"use client";

import {
  BarChart3,
  Beaker,
  Building2,
  FileCheck2,
  GitBranch,
  MapPin,
  Microscope,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { gsap, REDUCED_MOTION_QUERY } from "./gsap";

const CAPABILITIES: ReadonlyArray<{
  key:
    | "units"
    | "derivation"
    | "custody"
    | "quality"
    | "reporting"
    | "audit"
    | "inventory"
    | "workspace";
  icon: LucideIcon;
}> = [
  { key: "units", icon: Microscope },
  { key: "derivation", icon: GitBranch },
  { key: "custody", icon: MapPin },
  { key: "quality", icon: Beaker },
  { key: "reporting", icon: FileCheck2 },
  { key: "audit", icon: ScrollText },
  { key: "inventory", icon: BarChart3 },
  { key: "workspace", icon: Building2 },
];

/**
 * The platform's eight capabilities as an editorial index: two columns of ruled rows, no cards.
 *
 * Scrolled into view, each rule draws itself left to right and the row's content rises behind it,
 * one row after another. The whole index then rests switched off (see `.power-row` in globals.css)
 * and lights up while the pointer is anywhere over the section. Hovering a row fills its rule with
 * the accent and slides the title over; a soft light follows the pointer inside the row (two CSS
 * variables, no React state). With reduced motion the index is simply there.
 */
export function SpotlightGrid() {
  const t = useTranslations("marketing.capabilities.items");
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const scope = gsap.context(() => {
      const rows = gsap.utils.toArray<HTMLElement>(list.children);
      gsap.set(
        rows.map((row) => row.querySelector("[data-rule]")),
        {
          scaleX: 0,
          transformOrigin: "left center",
        }
      );
      gsap.set(
        rows.map((row) => row.querySelector("[data-content]")),
        { autoAlpha: 0, y: 32 }
      );

      const timeline = gsap.timeline({
        defaults: { ease: "expo.out" },
        scrollTrigger: { trigger: list, start: "top 85%", once: true },
      });
      rows.forEach((row, index) => {
        const at = index * 0.09;
        timeline
          .to(row.querySelector("[data-rule]"), { scaleX: 1, duration: 1.2 }, at)
          .to(row.querySelector("[data-content]"), { autoAlpha: 1, y: 0, duration: 1 }, at + 0.15);
      });
    }, list);
    return () => scope.revert();
  }, []);

  const follow = (event: PointerEvent<HTMLLIElement>) => {
    const row = event.currentTarget;
    const box = row.getBoundingClientRect();
    row.style.setProperty("--mx", `${event.clientX - box.left}px`);
    row.style.setProperty("--my", `${event.clientY - box.top}px`);
  };

  return (
    <div className="relative isolate mt-12">
      <div
        aria-hidden="true"
        className="power-glow pointer-events-none absolute -inset-x-4 -inset-y-6 -z-10 sm:-inset-x-8 bg-[radial-gradient(ellipse_at_50%_40%,var(--color-accent-soft),transparent_68%)]"
      />
      <ul ref={listRef} className="grid gap-x-16 border-b border-border lg:grid-cols-2">
        {CAPABILITIES.map(({ key, icon: Icon }, index) => (
          <li
            key={key}
            onPointerMove={follow}
            style={{ "--i": index } as CSSProperties}
            className="power-row group/row relative overflow-hidden"
          >
            <span
              aria-hidden="true"
              data-rule
              className="absolute inset-x-0 top-0 h-px bg-border-strong"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-accent-text transition-transform duration-700 ease-out group-hover/row:scale-x-100 motion-reduce:transition-none"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/row:opacity-100 bg-[radial-gradient(18rem_circle_at_var(--mx,50%)_var(--my,50%),var(--color-accent-soft),transparent_70%)]"
            />
            <div
              data-content
              className="relative grid grid-cols-[3rem_1fr_auto] items-start gap-x-2 py-7"
            >
              <span
                aria-hidden="true"
                className="pt-1.5 font-mono text-xs text-fg-tertiary transition-colors duration-300 group-hover/row:text-accent-text"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-xl font-semibold tracking-tight transition-transform duration-500 ease-out group-hover/row:translate-x-2 motion-reduce:transition-none sm:text-2xl">
                  {t(`${key}.title`)}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-fg-secondary transition-transform duration-500 ease-out group-hover/row:translate-x-2 motion-reduce:transition-none">
                  {t(`${key}.body`)}
                </p>
              </div>
              <span className="relative mt-1 flex size-10 items-center justify-center overflow-hidden rounded-full border border-border text-fg-secondary transition-colors duration-300 group-hover/row:border-accent-text group-hover/row:bg-accent group-hover/row:text-on-accent">
                <Icon
                  aria-hidden="true"
                  className="size-4.5 transition-transform duration-500 ease-out group-hover/row:scale-110 motion-reduce:transition-none"
                />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
