import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SERIES_COLOR_VAR } from "./chart-types";

/*
 * Usage (server component):
 *   <RingGauge ratio={0.83} valueText="83%" tone="warning" headline="Mostly passing"
 *     detail="7 of 9 results passed" footnote="Inconclusive results are not counted."
 *     ariaLabel="Lab pass rate: 83%, 7 of 9 results passed" />
 *
 * One ratio, one verdict. The ring fills clockwise from 12 o'clock; the words carry the meaning and the
 * colour (status tokens: success, warning, danger, neutral when there is no data) only reinforces them.
 * Rounded data end, track one step off the surface, no animation.
 */
export type RingGaugeProps = {
  /** 0 to 1, or null when there is nothing to measure. */
  ratio: number | null;
  /** The centre text, already formatted ("83%", or a dash for no data). */
  valueText: string;
  tone: "success" | "warning" | "danger" | "neutral";
  headline: ReactNode;
  detail?: ReactNode;
  footnote?: ReactNode;
  /** Full sentence for assistive technology: the SVG itself is decorative. */
  ariaLabel: string;
  className?: string;
};

const TONE_COLOR: Record<RingGaugeProps["tone"], string> = {
  success: SERIES_COLOR_VAR.success,
  warning: "var(--color-warning-solid)",
  danger: SERIES_COLOR_VAR.danger,
  neutral: SERIES_COLOR_VAR.neutral,
};

const SIZE = 120;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function RingGauge({
  ratio,
  valueText,
  tone,
  headline,
  detail,
  footnote,
  ariaLabel,
  className,
}: RingGaugeProps) {
  const filled = ratio === null ? 0 : CIRCUMFERENCE * Math.min(1, Math.max(0, ratio));
  const color = TONE_COLOR[tone];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-3"
        role="group"
        aria-label={ariaLabel}
      >
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }} aria-hidden>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              style={{ stroke: "var(--color-sunken)" }}
            />
            {filled > 0 ? (
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
                style={{ stroke: color }}
              />
            ) : null}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-fg tabular-nums">
            {valueText}
          </span>
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-xl font-semibold text-fg">{headline}</p>
          {detail ? <p className="mt-1 text-sm text-fg-secondary">{detail}</p> : null}
        </div>
      </div>
      {footnote ? <p className="text-sm text-fg-secondary">{footnote}</p> : null}
    </div>
  );
}
