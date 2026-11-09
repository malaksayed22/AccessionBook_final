"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { EASE_SOFT, gsap, MASK_HIDE, padMasks, REDUCED_MOTION_QUERY, SplitText } from "./gsap";

/**
 * Opening of a page section: a mono kicker, the heading and an optional intro.
 *
 * Scrolled into view, the heading's lines rise out of a mask one after another and the kicker and
 * intro fade in behind them. The heading stays real text (SplitText keeps an accessible label) and
 * is fully visible without JavaScript or with reduced motion.
 */
export function SectionIntro({
  id,
  kicker,
  title,
  intro,
  className,
}: {
  /** Id of the heading; the section points `aria-labelledby` at it. */
  id: string;
  kicker: string;
  title: string;
  intro?: string;
  className?: string;
}) {
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const introRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const heading = titleRef.current;
    if (!heading || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    let split: SplitText | undefined;
    let cancelled = false;
    const scope = gsap.context(() => {}, heading.parentElement ?? heading);

    void document.fonts.ready.then(() => {
      if (cancelled) return;
      scope.add(() => {
        split = SplitText.create(heading, { type: "lines", mask: "lines", aria: "none" });
        padMasks(split);
        const trigger = { trigger: heading, start: "top 86%", once: true };

        gsap.from(split.lines, {
          yPercent: MASK_HIDE,
          duration: 1.25,
          stagger: 0.12,
          ease: EASE_SOFT,
          scrollTrigger: trigger,
        });
        gsap.from([kickerRef.current, introRef.current].filter(Boolean), {
          autoAlpha: 0,
          y: 18,
          duration: 1,
          stagger: 0.15,
          ease: EASE_SOFT,
          scrollTrigger: trigger,
        });
      });
    });

    return () => {
      cancelled = true;
      scope.revert();
      split?.revert();
    };
  }, []);

  return (
    <div className={className}>
      <p
        ref={kickerRef}
        className="mb-4 font-mono text-xs tracking-[0.14em] text-accent-text uppercase"
      >
        {kicker}
      </p>
      <h2
        ref={titleRef}
        id={id}
        className="max-w-3xl text-4xl leading-[1.04] font-semibold tracking-[-0.04em] text-balance sm:text-5xl lg:text-6xl"
      >
        {title}
      </h2>
      {intro ? (
        <p
          ref={introRef}
          className={cn("mt-5 max-w-2xl text-base leading-relaxed text-fg-secondary sm:text-lg")}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}
