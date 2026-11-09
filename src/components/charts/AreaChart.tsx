"use client";

import { useFormatter } from "next-intl";
import { useId, useState, type PointerEvent } from "react";
import { GRADIENTS, glow } from "./palette";

/*
 * Usage:
 *   <AreaChart label="Activity" valueLabel="actions" points={[{ date: new Date(), value: 4 }]} />
 * A smooth gradient area with a glowing line. Move over it (or touch it) to read a day's figure in a
 * tooltip; the newest day carries a pulsing marker. Drawn as SVG; the line draws itself on load and
 * the global reduced-motion rule switches that off. A visually hidden table carries every figure.
 */
export type AreaPoint = { date: Date; value: number };

const WIDTH = 720;
const HEIGHT = 280;
const PAD = { left: 34, right: 14, top: 18, bottom: 30 };
const [FROM, TO] = GRADIENTS.indigo;

type Pt = { x: number; y: number };

/** Smooth curve through the points that never dips below or above the data (monotone cubic). */
function smoothPath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0]!.x},${points[0]!.y}`;

  const dx = points.slice(1).map((p, i) => p.x - points[i]!.x);
  const slope = points.slice(1).map((p, i) => (p.y - points[i]!.y) / dx[i]!);
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    return slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2;
  });
  slope.forEach((m, i) => {
    if (m === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      return;
    }
    const a = tangent[i]! / m;
    const b = tangent[i + 1]! / m;
    const sum = a * a + b * b;
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum);
      tangent[i] = tau * a * m;
      tangent[i + 1] = tau * b * m;
    }
  });

  return points
    .slice(1)
    .map((p, i) => {
      const q = points[i]!;
      const w = dx[i]! / 3;
      return `C${q.x + w},${q.y + tangent[i]! * w} ${p.x - w},${p.y - tangent[i + 1]! * w} ${p.x},${p.y}`;
    })
    .reduce((path, segment) => `${path} ${segment}`, `M${points[0]!.x},${points[0]!.y}`);
}

/** A round ceiling for the axis: never below 4, even up to 10, then 1, 2, 5 or 10 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  if (value <= 10) return Math.ceil(value / 2) * 2;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}

export function AreaChart({
  label,
  valueLabel,
  points,
}: {
  /** Accessible name of the chart. */
  label: string;
  /** What the height counts ("actions"), named in the tooltip and the table. */
  valueLabel: string;
  points: AreaPoint[];
}) {
  const format = useFormatter();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const top = niceMax(Math.max(0, ...points.map((point) => point.value)));
  const ticks = [0, top / 2, top];
  const baseline = HEIGHT - PAD.bottom;
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;

  const coords: Pt[] = points.map((point, index) => ({
    x: PAD.left + (innerWidth * index) / Math.max(points.length - 1, 1),
    y: PAD.top + innerHeight * (1 - point.value / top),
  }));

  const line = smoothPath(coords);
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = first && last ? `${line} L${last.x},${baseline} L${first.x},${baseline} Z` : "";
  const shown = hover ?? coords.length - 1;
  const active = coords[shown];
  const activePoint = points[shown];

  const dayLong = (date: Date) => format.dateTime(date, { dateStyle: "medium" });
  const dayShort = (date: Date) => format.dateTime(date, { day: "numeric", month: "short" });

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * innerWidth + PAD.left;
    let nearest = 0;
    coords.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs((coords[nearest]?.x ?? 0) - x)) nearest = index;
    });
    setHover(nearest);
  };

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full overflow-visible"
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: FROM, stopOpacity: 0.42 }} />
            <stop offset="0.65" style={{ stopColor: TO, stopOpacity: 0.1 }} />
            <stop offset="1" style={{ stopColor: TO, stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: GRADIENTS.ocean[0] }} />
            <stop offset="0.55" style={{ stopColor: FROM }} />
            <stop offset="1" style={{ stopColor: TO }} />
          </linearGradient>
        </defs>

        <g aria-hidden="true" className="text-[11px]">
          {ticks.map((tick) => {
            const y = PAD.top + innerHeight * (1 - tick / top);
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y}
                  y2={y}
                  strokeDasharray={tick === 0 ? undefined : "3 6"}
                  className={tick === 0 ? "stroke-border-strong" : "stroke-border"}
                />
                <text
                  x={PAD.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-fg-tertiary tabular-nums"
                >
                  {format.number(tick, "count")}
                </text>
              </g>
            );
          })}
          {points.map((point, index) =>
            (points.length - 1 - index) % 5 === 0 ? (
              <text
                key={point.date.toISOString()}
                x={coords[index]?.x}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-fg-tertiary"
              >
                {dayShort(point.date)}
              </text>
            ) : null
          )}
        </g>

        <path d={area} fill={`url(#${uid}-fill)`} className="area-in" />
        <path
          d={line}
          pathLength={1}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          stroke={`url(#${uid}-stroke)`}
          className="draw-line"
          style={{ filter: `drop-shadow(0 6px 10px ${glow(TO, 50)})` }}
        />

        {active ? (
          <g aria-hidden="true">
            {hover !== null ? (
              <line
                x1={active.x}
                x2={active.x}
                y1={PAD.top}
                y2={baseline}
                strokeDasharray="3 4"
                className="stroke-border-strong"
              />
            ) : (
              <circle
                cx={active.x}
                cy={active.y}
                r={7}
                className="ping-ring"
                style={{ fill: TO }}
              />
            )}
            <circle
              cx={active.x}
              cy={active.y}
              r={5.5}
              className="stroke-surface"
              strokeWidth={3}
              style={{ fill: TO, filter: `drop-shadow(0 0 6px ${glow(TO, 80)})` }}
            />
          </g>
        ) : null}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerWidth}
          height={innerHeight + 8}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null && active && activePoint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-xl border border-border-strong bg-raised/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm"
          style={{
            left: `${Math.min(Math.max((active.x / WIDTH) * 100, 12), 88)}%`,
            top: `${(active.y / HEIGHT) * 100}%`,
            transform: "translate(-50%, calc(-100% - 14px))",
          }}
        >
          <p className="text-fg-secondary">{dayLong(activePoint.date)}</p>
          <p className="mt-0.5 text-sm font-semibold text-fg tabular-nums">
            {format.number(activePoint.value, "count")}{" "}
            <span className="font-normal text-fg-secondary">{valueLabel}</span>
          </p>
        </div>
      ) : null}

      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.date.toISOString()}>
              <th scope="row">{dayLong(point.date)}</th>
              <td>{format.number(point.value, "count")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
