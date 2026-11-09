import { useId, type ReactNode } from "react";
import { glow, type Gradient } from "./palette";

/*
 * Usage:
 *   <GaugeChart label="Pass rate" value={0.6} display="60%" caption="Pass rate" gradient={STATUS.good} />
 * An open ring that fills to `value` (0 to 1), with the figure in the middle. Server-friendly; the arc
 * sweeps in on load. `display` is what is printed, so the ring never carries the number alone.
 */
const RADIUS = 15.9155; // circumference 100
const SWEEP = 75; // the ring is open at the bottom: three quarters of a circle

export function GaugeChart({
  label,
  value,
  display,
  caption,
  gradient,
}: {
  /** Accessible name, including the figure. */
  label: string;
  /** 0 to 1. */
  value: number;
  display: ReactNode;
  caption: ReactNode;
  gradient: Gradient;
}) {
  const uid = useId().replace(/:/g, "");
  const filled = Math.min(1, Math.max(0, value)) * SWEEP;

  return (
    <div role="img" aria-label={label} className="relative mx-auto size-44 shrink-0">
      <svg viewBox="0 0 42 42" aria-hidden="true" className="size-full rotate-135 overflow-visible">
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: gradient[0] }} />
            <stop offset="1" style={{ stopColor: gradient[1] }} />
          </linearGradient>
        </defs>
        <circle
          cx="21"
          cy="21"
          r={RADIUS}
          fill="none"
          strokeWidth={4.4}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${SWEEP} ${100 - SWEEP}`}
          className="stroke-sunken"
        />
        {filled > 0 ? (
          <circle
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            strokeWidth={4.4}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${filled} ${100 - filled}`}
            stroke={`url(#${uid})`}
            className="ring-in"
            style={{ filter: `drop-shadow(0 0 1.8px ${glow(gradient[1], 80)})` }}
          />
        ) : null}
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center text-center"
      >
        <span className="text-4xl leading-none font-semibold tracking-[-0.04em] text-fg tabular-nums">
          {display}
        </span>
        <span className="mt-1.5 text-xs text-fg-secondary">{caption}</span>
      </div>
    </div>
  );
}
