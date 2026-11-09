"use client";

import { useEffect, useRef } from "react";
import { gsap, REDUCED_MOTION_QUERY } from "./gsap";

/** A hairline spectrum bar at the top of the window that fills as the page is read. */
export function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const scope = gsap.context(() => {
      gsap.to(bar, {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      });
    }, bar);
    return () => scope.revert();
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div ref={barRef} className="size-full origin-left scale-x-0 bg-accent-text" />
    </div>
  );
}
