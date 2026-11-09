"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { EASE_SOFT, gsap, REDUCED_MOTION_QUERY } from "./gsap";

const LINES = ["inventory", "destruction", "custody", "audit"] as const;

/** Artwork only: example seals in the mock-up, identical in every language. */
const SEALS: Record<(typeof LINES)[number], string> = {
  inventory: "9c41 e07a",
  destruction: "3be8 52d1",
  custody: "f7a0 1c96",
  audit: "58d2 b3e4",
};

const SEAL_CHARS = "0123456789abcdef";

/**
 * An illustration of the kinds of record the system keeps, drawn as an append-only chain: each
 * entry is written under the one before it, joined by a rule, and sealed with a short hash.
 *
 * Scrolled into view the entries are appended one by one. The node lands with a ripple, the rule
 * runs down to the next entry and the seal resolves out of scrambled characters. Without JavaScript
 * or with reduced motion the finished chain is simply shown.
 */
export function ComplianceLedger() {
  const t = useTranslations("marketing.compliance");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const scope = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(list.children).forEach((row) => {
        const body = row.querySelector("[data-body]");
        const node = row.querySelector("[data-node]");
        const pulse = row.querySelector("[data-pulse]");
        const seal = row.querySelector<HTMLElement>("[data-seal]");
        const segment = row.querySelector("[data-segment]");

        const timeline = gsap.timeline({
          defaults: { ease: EASE_SOFT },
          scrollTrigger: { trigger: row, start: "top 82%", once: true },
        });
        timeline
          .from(body, { autoAlpha: 0, x: 28, duration: 1 })
          .from(node, { scale: 0, duration: 0.6, ease: "back.out(3)" }, 0.1)
          .fromTo(
            pulse,
            { scale: 1, autoAlpha: 0.6 },
            { scale: 3.2, autoAlpha: 0, duration: 1 },
            0.2
          );
        if (seal) {
          timeline.to(
            seal,
            {
              scrambleText: { text: seal.textContent ?? "", chars: SEAL_CHARS, speed: 0.5 },
              duration: 1,
              ease: "none",
            },
            0.25
          );
        }
        if (segment) {
          timeline.from(
            segment,
            { scaleY: 0, transformOrigin: "top center", duration: 1, ease: "power2.inOut" },
            0.4
          );
        }
      });
    }, list);
    return () => scope.revert();
  }, []);

  return (
    <figure aria-label={t("ledgerLabel")} className="overflow-x-clip">
      <figcaption className="flex items-center justify-between border-b border-border pb-4">
        <span className="font-mono text-xs tracking-[0.14em] text-fg-secondary uppercase">
          {t("ledgerName")}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-accent-soft-border bg-accent-soft px-3 py-1 text-xs font-medium text-accent-text">
          <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-accent-text" />
          {t("appendOnly")}
        </span>
      </figcaption>

      <ol ref={listRef}>
        {LINES.map((line, index) => (
          <li key={line} className="relative grid grid-cols-[2rem_1fr] gap-x-5 py-7">
            {index < LINES.length - 1 ? (
              <span
                aria-hidden="true"
                data-segment
                className="absolute start-4 top-[2.8rem] bottom-[-2.8rem] w-px -translate-x-1/2 bg-linear-to-b from-accent-text to-border-strong"
              />
            ) : null}
            <span aria-hidden="true" className="relative flex justify-center pt-2">
              <span
                data-node
                className="relative z-10 mt-0.5 size-3.5 rounded-full border-2 border-accent-text bg-bg"
              >
                <span
                  data-pulse
                  className="absolute -inset-0.5 rounded-full border border-accent-text opacity-0"
                />
                <span className="absolute inset-0.5 rounded-full bg-accent-text" />
              </span>
            </span>
            <div data-body>
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-xs font-semibold tracking-[0.16em] text-accent-text">
                  {t(`codes.${line}`)}
                </span>
                <span aria-hidden="true" className="font-mono text-xs text-fg-tertiary">
                  #<span data-seal>{SEALS[line]}</span>
                </span>
              </div>
              <p className="mt-2.5 text-lg font-semibold tracking-tight">
                {t(`lines.${line}.title`)}
              </p>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-fg-secondary">
                {t(`lines.${line}.detail`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
