"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { EASE_SOFT, gsap } from "./gsap";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Whether the visitor asked for less motion. The server (and the first client render) report true,
 * so nothing autoplays until the browser has answered; a motion-loving visitor gets the animation
 * one render later, a motion-sensitive one never sees it start.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true
  );
}

/**
 * Brings a block in the first time it scrolls into view: it rises, sharpens out of a blur and
 * fades up, driven by GSAP's ScrollTrigger.
 *
 * The block is visible in the server HTML and stays visible without JavaScript, and for anyone who
 * prefers reduced motion (the effect never touches it). Only when motion is welcome and the block
 * is still below the fold does the effect hide and then animate it, so there is no flash.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** Milliseconds to wait once visible, to stagger siblings. */
  delay?: number;
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia(QUERY).matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    const scope = gsap.context(() => {
      gsap.fromTo(
        element,
        { autoAlpha: 0, y: 48, filter: "blur(8px)" },
        {
          autoAlpha: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 1.1,
          delay: delay / 1000,
          ease: EASE_SOFT,
          scrollTrigger: { trigger: element, start: "top 88%", once: true },
        }
      );
    }, element);
    return () => scope.revert();
  }, [delay]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
