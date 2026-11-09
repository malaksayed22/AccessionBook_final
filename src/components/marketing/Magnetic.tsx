"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { gsap, REDUCED_MOTION_QUERY } from "./gsap";

/** How far, as a share of the pointer's offset from the centre, the wrapped control is pulled. */
const PULL = 0.28;

/**
 * Wraps a control so it drifts a few pixels toward the pointer while hovered and springs back on
 * leave. Fine pointers only: touch screens and reduced-motion visitors get a plain wrapper.
 */
export function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const moveX = gsap.quickTo(element, "x", { duration: 0.5, ease: "power3.out" });
    const moveY = gsap.quickTo(element, "y", { duration: 0.5, ease: "power3.out" });

    const onMove = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      moveX((event.clientX - (box.left + box.width / 2)) * PULL);
      moveY((event.clientY - (box.top + box.height / 2)) * PULL);
    };
    const onLeave = () => {
      moveX(0);
      moveY(0);
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      gsap.set(element, { clearProps: "transform" });
    };
  }, []);

  return (
    <span ref={ref} className={cn("inline-flex", className)}>
      {children}
    </span>
  );
}
