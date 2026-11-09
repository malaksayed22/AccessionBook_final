"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { gsap, REDUCED_MOTION_QUERY, ScrollTrigger } from "./gsap";

/**
 * Inertial scrolling for the public page, wired into GSAP's ticker so ScrollTrigger and the 3D
 * scene read the same smoothed position. Nothing renders; it only installs behaviour.
 *
 * Skipped entirely when the visitor asked for reduced motion: they keep native scrolling.
 * In-page anchors (`#platform`) are routed through Lenis so they glide instead of jumping.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9, anchors: { offset: -72 } });
    const onTick = (time: number) => lenis.raf(time * 1000);

    // Pinned sections add scroll distance after Lenis has measured the page (the hero's spacer appears
    // once the 3D model has loaded). Without a re-measure Lenis would stop short of the real bottom.
    const remeasure = () => lenis.resize();

    lenis.on("scroll", ScrollTrigger.update);
    ScrollTrigger.addEventListener("refresh", remeasure);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      ScrollTrigger.removeEventListener("refresh", remeasure);
      gsap.ticker.remove(onTick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, []);

  return null;
}
