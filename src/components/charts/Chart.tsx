"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { bandLayout, labelSlots, maxOf, niceTicks, scaleLinear, slotIndexAt } from "./chart-math";
import { SERIES_COLOR_VAR, type ChartData, type ChartSeries } from "./chart-types";

/*
 * Usage (props are plain data, already translated and formatted by the server component):
 *   <Chart kind="line" area ariaLabel="Units in inventory" slots={slots} series={series} emptyLabel="No units yet" />
 *   <Chart kind="column" mode="stacked" ariaLabel="Movements" slots={slots} series={series} />
 *
 * What every chart gets, by default:
 * - A legend for two or more series (one series is named by the heading), line keys for lines and
 *   squares for bars, never colour alone.
 * - Hover or keyboard inspection: a crosshair (line) or highlighted column, and one tooltip listing every
 *   series at that point. The plot is focusable; Left/Right/Home/End move, Escape clears. The same text is
 *   announced through a polite live region.
 * - A table view (a <details> disclosure) with every value, so nothing depends on hovering or on colour.
 * - Hairline gridlines, 2px lines, columns at most 24px wide with a 4px rounded data end and a 2px gap
 *   between stacked segments, an 8px end dot with a surface ring. Text always wears text tokens.
 * - Nothing animates, so reduced-motion needs no special case.
 */
type Props = ChartData & {
  kind: "line" | "column";
  /** Columns: stack the series in one column, or place them side by side. */
  mode?: "stacked" | "grouped";
  /** Lines: wash under the line (use for a single series). */
  area?: boolean;
  /** Accessible name and table caption. */
  ariaLabel: string;
  /** Shown instead of the plot when every value is zero. The table view stays available. */
  emptyLabel?: string;
  height?: number;
  className?: string;
};

const MARGIN = { top: 10, right: 12, bottom: 28, left: 44 };
const GAP = 2;
const FALLBACK_WIDTH = 640;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A column with only its top corners rounded (square at the baseline). */
function topRounded(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

export function Chart({
  kind,
  mode = "stacked",
  area = false,
  ariaLabel,
  emptyLabel,
  height = 220,
  className,
  slots,
  series,
}: Props) {
  const t = useTranslations("ui.charts");
  const format = useFormatter();
  const [containerRef, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const descriptionId = useId();
  const tableId = useId();

  const count = slots.length;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const stacked = kind === "column" && mode === "stacked";
  const yMax =
    niceTicks(
      maxOf(
        series.map((s) => s.values),
        stacked
      )
    ).at(-1) ?? 1;
  const ticks = niceTicks(yMax);
  const y = scaleLinear([0, yMax], [MARGIN.top + plotHeight, MARGIN.top]);
  const band = bandLayout(count, plotWidth, { maxBar: 24 });
  const xs = labelSlots(count, plotWidth);
  const hasData = series.some((s) => s.values.some((v) => v > 0));

  const number = useCallback((value: number) => format.number(value, "count"), [format]);
  const compact = (value: number) => format.number(value, { notation: "compact" });
  const lineX = (index: number) => MARGIN.left + band.center(index);

  const describe = (index: number) => {
    const slot = slots[index];
    if (!slot) return "";
    const parts = series.map((s) => `${s.label}: ${number(s.values[index] ?? 0)}`);
    return `${slot.fullLabel}. ${parts.join(", ")}`;
  };

  function indexFromPointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width / width;
    return slotIndexAt((event.clientX - rect.left) / scale - MARGIN.left, plotWidth, count);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (count === 0) return;
    const move = (to: number) => {
      event.preventDefault();
      setActive(Math.min(count - 1, Math.max(0, to)));
    };
    if (event.key === "ArrowRight") move((active ?? -1) + 1);
    else if (event.key === "ArrowLeft") move((active ?? count) - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(count - 1);
    else if (event.key === "Escape") setActive(null);
  }

  const tooltipLeft = active === null ? 0 : lineX(active);
  const flip = tooltipLeft > width * 0.6;

  return (
    <figure className={cn("min-w-0", className)}>
      {series.length > 1 ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
          {series.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "inline-block",
                  kind === "line" ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-xs"
                )}
                style={{ background: SERIES_COLOR_VAR[s.color] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div ref={containerRef} className="relative" style={{ height }}>
        {!hasData && emptyLabel ? (
          <p className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-fg-secondary">
            {emptyLabel}
          </p>
        ) : (
          <>
            <svg
              ref={svgRef}
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="group"
              aria-label={`${ariaLabel}. ${t("hint")}`}
              aria-describedby={descriptionId}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onFocus={() => setActive((current) => current ?? count - 1)}
              onBlur={() => setActive(null)}
              onPointerMove={(event) => setActive(indexFromPointer(event))}
              onPointerLeave={() => setActive(null)}
              className="block rounded-lg touch-pan-y focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {/* Gridlines and y-axis ticks: hairline, solid, recessive. */}
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={y(tick)}
                    y2={y(tick)}
                    strokeWidth={1}
                    style={{ stroke: "var(--color-chart-grid)" }}
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={y(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={12}
                    style={{ fill: "var(--color-fg-secondary)" }}
                  >
                    {compact(tick)}
                  </text>
                </g>
              ))}

              {slots.map((slot, index) =>
                xs.has(index) ? (
                  <text
                    key={slot.key}
                    x={lineX(index)}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize={12}
                    style={{ fill: "var(--color-fg-secondary)" }}
                  >
                    {slot.label}
                  </text>
                ) : null
              )}

              {active !== null && kind === "column" ? (
                <rect
                  x={MARGIN.left + band.slot * active}
                  y={MARGIN.top}
                  width={band.slot}
                  height={plotHeight}
                  rx={4}
                  style={{ fill: "var(--color-hover)" }}
                />
              ) : null}

              {kind === "line"
                ? renderLines({
                    series,
                    y,
                    lineX,
                    count,
                    area,
                    plotBottom: MARGIN.top + plotHeight,
                    active,
                  })
                : renderColumns({
                    series,
                    y,
                    band,
                    stacked,
                    count,
                    plotBottom: MARGIN.top + plotHeight,
                  })}

              {active !== null && kind === "line" ? (
                <line
                  x1={lineX(active)}
                  x2={lineX(active)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                  strokeWidth={1}
                  style={{ stroke: "var(--color-border-input)" }}
                />
              ) : null}
            </svg>

            {active !== null && slots[active] ? (
              <div
                aria-hidden
                className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-border bg-raised px-3 py-2 text-sm shadow-md"
                style={{
                  top: 0,
                  left: tooltipLeft,
                  transform: `translateX(${flip ? "calc(-100% - 12px)" : "12px"})`,
                }}
              >
                <p className="mb-1 font-medium text-fg">{slots[active].fullLabel}</p>
                <ul className="space-y-0.5">
                  {series.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block",
                          kind === "line" ? "h-0.5 w-3 rounded-full" : "size-2 rounded-xs"
                        )}
                        style={{ background: SERIES_COLOR_VAR[s.color] }}
                      />
                      <span className="font-semibold text-fg tabular-nums">
                        {number(s.values[active] ?? 0)}
                      </span>
                      <span className="text-fg-secondary">{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>

      <p id={descriptionId} role="status" aria-live="polite" className="sr-only">
        {active !== null ? describe(active) : ""}
      </p>

      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-sm text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {t("table")}
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border">
          <table id={tableId} className="w-full border-collapse text-left">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="sticky top-0 bg-sunken">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-fg-secondary">
                  {t("period")}
                </th>
                {series.map((s) => (
                  <th
                    key={s.id}
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-fg-secondary"
                  >
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, index) => (
                <tr key={slot.key} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 font-normal text-fg">
                    {slot.fullLabel}
                  </th>
                  {series.map((s) => (
                    <td key={s.id} className="px-3 py-1.5 text-right text-fg tabular-nums">
                      {number(s.values[index] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

type Scale = (value: number) => number;

function renderLines({
  series,
  y,
  lineX,
  count,
  area,
  plotBottom,
  active,
}: {
  series: ChartSeries[];
  y: Scale;
  lineX: (index: number) => number;
  count: number;
  area: boolean;
  plotBottom: number;
  active: number | null;
}) {
  return series.map((s) => {
    const points = Array.from({ length: count }, (_, i) => `${lineX(i)},${y(s.values[i] ?? 0)}`);
    const color = SERIES_COLOR_VAR[s.color];
    const dotAt = active ?? count - 1;
    return (
      <g key={s.id}>
        {area && count > 1 ? (
          <polygon
            points={`${lineX(0)},${plotBottom} ${points.join(" ")} ${lineX(count - 1)},${plotBottom}`}
            fillOpacity={0.1}
            style={{ fill: color }}
          />
        ) : null}
        <polyline
          points={points.join(" ")}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ stroke: color }}
        />
        {count > 0 ? (
          <circle
            cx={lineX(dotAt)}
            cy={y(s.values[dotAt] ?? 0)}
            r={4}
            strokeWidth={2}
            style={{ fill: color, stroke: "var(--color-surface)" }}
          />
        ) : null}
      </g>
    );
  });
}

function renderColumns({
  series,
  y,
  band,
  stacked,
  count,
  plotBottom,
}: {
  series: ChartSeries[];
  y: Scale;
  band: ReturnType<typeof bandLayout>;
  stacked: boolean;
  count: number;
  plotBottom: number;
}) {
  const marks: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    if (stacked) {
      let base = 0;
      const visible = series.filter((s) => (s.values[i] ?? 0) > 0);
      visible.forEach((s, order) => {
        const value = s.values[i] ?? 0;
        const top = y(base + value);
        const bottom = y(base);
        // The 2px surface gap sits between touching segments; the baseline segment stays square.
        const trim = order > 0 ? GAP : 0;
        const segHeight = Math.max(1, bottom - top - trim);
        const isTop = order === visible.length - 1;
        const x = band.x(i) + MARGIN.left;
        marks.push(
          <path
            key={`${s.id}-${i}`}
            d={
              isTop
                ? topRounded(x, top, band.bar, segHeight, 4)
                : `M${x},${top + segHeight} V${top} H${x + band.bar} V${top + segHeight} Z`
            }
            style={{ fill: SERIES_COLOR_VAR[s.color] }}
          />
        );
        base += value;
      });
    } else {
      const n = series.length;
      const bar = Math.max(1, Math.min(24, (band.slot * 0.7 - GAP * (n - 1)) / n));
      const groupWidth = bar * n + GAP * (n - 1);
      series.forEach((s, order) => {
        const value = s.values[i] ?? 0;
        if (value <= 0) return;
        const x = MARGIN.left + i * band.slot + (band.slot - groupWidth) / 2 + order * (bar + GAP);
        const top = y(value);
        marks.push(
          <path
            key={`${s.id}-${i}`}
            d={topRounded(x, top, bar, Math.max(1, plotBottom - top), 4)}
            style={{ fill: SERIES_COLOR_VAR[s.color] }}
          />
        );
      });
    }
  }
  return marks;
}
