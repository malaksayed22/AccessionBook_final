"use client";

import { useEffect, useRef } from "react";
import { gsap, REDUCED_MOTION_QUERY } from "./gsap";

/**
 * A statement that lights up word by word as the visitor scrolls through it.
 *
 * Every word starts dim and is brought to full strength by a scrubbed tween, so reading speed is
 * scroll speed. The text is plain words in the DOM; with reduced motion, or before the script
 * runs, all of it is shown at full strength.
 */
export function ScrollText({ text, className }: { text: string; className?: string }) {
  const rootRef = useRef<HTMLParagraphElement>(null);
  const words = text.split(/\s+/).filter(Boolean);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const scope = gsap.context(() => {
      const targets = root.querySelectorAll("[data-word]");
      gsap.fromTo(
        targets,
        { opacity: 0.55 },
        {
          opacity: 1,
          ease: "none",
          stagger: 0.12,
          scrollTrigger: { trigger: root, start: "top 78%", end: "bottom 42%", scrub: 0.6 },
        }
      );
    }, root);
    return () => scope.revert();
  }, []);

  return (
    <p ref={rootRef} className={className}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} data-word>
          {word}
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
