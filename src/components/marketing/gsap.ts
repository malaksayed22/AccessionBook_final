"use client";

import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

/**
 * One place that registers GSAP plugins, so every marketing component imports the same instance.
 * Registration is idempotent and only runs in the browser (the plugins touch `window`).
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, MotionPathPlugin, ScrambleTextPlugin);
}

export { gsap, MotionPathPlugin, ScrambleTextPlugin, ScrollTrigger, SplitText };

/**
 * SplitText masks clip at the line box, which cuts descenders (the "g" in "lineage") whenever the
 * heading's line-height is tight. Grow every mask downward and pull the next line back up by the
 * same amount, so the layout is unchanged and nothing is clipped. Pair with `MASK_HIDE` when
 * starting a line below its mask.
 */
export function padMasks(split: SplitText, bottomEm = 0.18) {
  for (const mask of split.masks as HTMLElement[]) {
    mask.style.paddingBottom = `${bottomEm}em`;
    mask.style.marginBottom = `-${bottomEm}em`;
  }
}

/** Starting offset that parks a line fully below its (padded) mask. */
export const MASK_HIDE = 135;

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** House easing for the public site: fast start, long soft landing. */
export const EASE_OUT = "power4.out";
export const EASE_SOFT = "expo.out";
