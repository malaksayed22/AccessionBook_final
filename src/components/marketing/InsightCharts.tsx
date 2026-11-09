"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { gsap, REDUCED_MOTION_QUERY } from "./gsap";

/*
 * Illustrative figures only. They show what the product's reporting looks like and are labelled as
 * examples on the page; nothing here is customer data.
 */
const UNITS_UNDER_CUSTODY = [310, 342, 365, 398, 420, 455, 491, 520, 563, 601, 648, 702];
/** First month of the series: October 2025. Fixed, so server and browser render the same labels. */
const SERIES_START = Date.UTC(2025, 9, 1);

const RANGES = [
  { key: "six", months: 6 },
  { key: "twelve", months: 12 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/**
 * One ink for the line, bar and sparkline series, taken from the design tokens, plus amber for
 * "held" alone so the exception is the only thing that changes colour. Reads the same on the light
 * and the dark theme.
 */
const INK = "var(--color-series-1)";
const HELD = "var(--color-series-5)";

/** The stage donut keeps its own four-hue palette; the other charts stay on the single ink. */
const STAGES = [
  { key: "process", share: 42, color: "#6366f1" },
  { key: "conditioning", share: 26, color: "#0ea5e9" },
  { key: "culture", share: 20, color: "#10b981" },
  { key: "storage", share: 12, color: "#8b5cf6" },
] as const;

const RESULTS = [
  { free: 118, held: 9 },
  { free: 126, held: 7 },
  { free: 131, held: 8 },
  { free: 139, held: 5 },
  { free: 148, held: 4 },
  { free: 157, held: 3 },
];

const KPIS = [
  { key: "units", value: 702, trend: [410, 455, 491, 520, 563, 601, 648, 702] },
  { key: "transfers", value: 1284, trend: [740, 810, 905, 980, 1040, 1130, 1210, 1284] },
  { key: "events", value: 18430, trend: [9200, 10400, 12100, 13300, 14800, 16100, 17200, 18430] },
  { key: "holds", value: 3, trend: [9, 7, 8, 5, 4, 4, 3, 3] },
] as const;

const DONUT_STROKE = 4.6;
/** Share points between neighbours. Round caps add half the stroke to each end, so the gap must exceed it. */
const DONUT_GAP = DONUT_STROKE + 1.6;

/**
 * Donut segments with rounded ends. Each arc is shortened by the gap and shifted by half of it, so the
 * space between neighbours is even and the whole ring stays centred on its shares.
 */
const STAGE_SEGMENTS = STAGES.map((item, index) => ({
  ...item,
  length: Math.max(item.share - DONUT_GAP, 0.1),
  offset: -(
    STAGES.slice(0, index).reduce((sum, previous) => sum + previous.share, 0) +
    DONUT_GAP / 2
  ),
}));

const AREA = { width: 640, height: 320, left: 44, right: 16, top: 16, bottom: 30, max: 800 };
const BARS = { width: 360, height: 170, left: 30, top: 18, bottom: 24, max: 170 };
const BAR_TICKS = [0, 50, 100, 150];
const BAR_WIDTH = 24;

type Point = { x: number; y: number };

/** Straight segments between the points: monthly figures are not interpolated into curves. */
const linePathOf = (points: Point[]) =>
  points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");

/**
 * The area chart's reveal as one timeline: the line draws itself left to right, the fill is wiped in
 * at the same pace, and the end marker appears as the line arrives.
 */
function revealArea(root: HTMLElement, duration = 1.5) {
  const line = root.querySelector<SVGPathElement>("[data-area-line]");
  const wipe = root.querySelector<SVGRectElement>("[data-reveal]");
  const marker = root.querySelector<SVGGElement>("[data-dot]");
  const timeline = gsap.timeline({ defaults: { ease: "power2.inOut", duration } });
  if (!line) return timeline;

  timeline.fromTo(line, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, 0);
  if (wipe) {
    const full = Number(wipe.dataset.reveal);
    timeline.fromTo(wipe, { attr: { width: 0 } }, { attr: { width: full } }, 0);
  }
  if (marker) {
    timeline.fromTo(
      marker,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.3, ease: "none" },
      duration - 0.1
    );
  }
  return timeline;
}

const monthOf = (index: number) => new Date(SERIES_START + index * 31 * 24 * 3600 * 1000);

/**
 * "Reporting at a glance": one panel holding four counters, an area chart with a hover read-out, a
 * donut and stacked bars, all drawn as SVG (square corners, hairline axes and straight data lines on the line and bar charts)
 * and animated with GSAP when the panel scrolls into view.
 *
 * The line draws itself with the fill wiped in behind it, bars grow from their baseline, donut
 * segments sweep in and the counters tick up. The line, bar and sparkline series are flat; the stage
 * donut keeps its rounded, four-colour look. With reduced motion the finished charts are shown
 * straight away. Every figure is an example; the panel says so.
 */
export function InsightCharts() {
  const t = useTranslations("marketing.insight");
  const format = useFormatter();
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
  }, [format]);

  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const ids = { fill: `${uid}-fill`, reveal: `${uid}-reveal` };
  const [range, setRange] = useState<RangeKey>("twelve");
  const [hover, setHover] = useState<number | null>(null);
  const [bar, setBar] = useState<number | null>(null);
  const [stage, setStage] = useState<(typeof STAGES)[number]["key"] | null>(null);
  const drawnRange = useRef<RangeKey>(range);

  const months = RANGES.find((item) => item.key === range)?.months ?? 12;
  const values = UNITS_UNDER_CUSTODY.slice(-months);

  const points = useMemo<Point[]>(() => {
    const innerWidth = AREA.width - AREA.left - AREA.right;
    const innerHeight = AREA.height - AREA.top - AREA.bottom;
    return values.map((value, index) => ({
      x: AREA.left + (innerWidth * index) / Math.max(values.length - 1, 1),
      y: AREA.top + innerHeight * (1 - value / AREA.max),
    }));
  }, [values]);

  const linePath = linePathOf(points);
  const baseline = AREA.height - AREA.bottom;
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const areaPath =
    lastPoint && firstPoint
      ? `${linePath} L${lastPoint.x},${baseline} L${firstPoint.x},${baseline} Z`
      : "";

  const monthIndex = (i: number) => UNITS_UNDER_CUSTODY.length - values.length + i;
  const monthShort = (i: number) =>
    format.dateTime(monthOf(monthIndex(i)), { month: "short", timeZone: "UTC" });
  const monthLong = (i: number) =>
    format.dateTime(monthOf(monthIndex(i)), { month: "long", year: "numeric", timeZone: "UTC" });

  const onAreaMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * AREA.width;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs((points[nearest]?.x ?? 0) - x)) nearest = index;
    });
    setHover(nearest);
  };

  /* First reveal: runs once, when the panel is a little way into the viewport. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const pick = (selector: string) => root.querySelectorAll<SVGElement | HTMLElement>(selector);
      const timeline = gsap.timeline({
        defaults: { ease: "power3.out" },
        scrollTrigger: { trigger: root, start: "top 78%", once: true },
      });

      timeline
        .from(pick("[data-card]"), {
          autoAlpha: 0,
          y: 36,
          duration: 0.9,
          stagger: 0.1,
          ease: "expo.out",
        })
        .fromTo(
          pick("[data-draw]"),
          { strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: 1.6, stagger: 0.08, ease: "power2.inOut" },
          0.25
        )
        .add(revealArea(root), 0.35)
        .from(
          pick("[data-bar]"),
          { scaleY: 0, duration: 0.9, stagger: 0.07, ease: "power3.out" },
          0.55
        )
        .from(
          pick("[data-held]"),
          { scaleY: 0, duration: 0.5, stagger: 0.07, ease: "power2.out" },
          1.1
        )
        .from(
          pick("[data-month]"),
          { autoAlpha: 0, duration: 0.6, stagger: 0.05, ease: "none" },
          0.9
        );

      pick("[data-segment]").forEach((segment, index) => {
        const length = Number(segment.dataset.length);
        timeline.fromTo(
          segment,
          { strokeDasharray: `0.01 100` },
          { strokeDasharray: `${length} ${100 - length}`, duration: 1.3, ease: "power3.out" },
          0.35 + index * 0.14
        );
      });

      pick("[data-count]").forEach((element) => {
        const target = Number(element.dataset.count);
        const counter = { value: 0 };
        timeline.to(
          counter,
          {
            value: target,
            duration: 1.6,
            ease: "power2.out",
            onUpdate: () => {
              element.textContent = formatRef.current.number(Math.round(counter.value));
            },
          },
          0.5
        );
      });
    });

    return () => media.revert();
  }, []);

  /* Switching the range redraws the line. */
  useEffect(() => {
    /* Compare with the range last drawn rather than counting runs: dev mode runs effects twice on mount. */
    if (drawnRange.current === range) return;
    drawnRange.current = range;
    const root = rootRef.current;
    if (!root || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    const scope = gsap.context(() => {
      revealArea(root, 1.1);
    }, root);
    return () => scope.revert();
  }, [range]);

  const totalLength = STAGES.reduce((sum, item) => sum + item.share, 0);
  const activeStage = STAGES.find((item) => item.key === stage);

  const slot = (BARS.width - BARS.left) / RESULTS.length;
  const barHeight = BARS.height - BARS.top - BARS.bottom;
  const barBase = BARS.height - BARS.bottom;
  const scaleBar = (value: number) => (value / BARS.max) * barHeight;

  /** Every block is a cell of one panel; the hairlines between cells come from the grid's gap. */
  const cell = "bg-bg p-4 sm:p-5";

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-md border border-border-strong bg-bg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <p className="font-mono text-xs tracking-[0.12em] text-fg-tertiary uppercase">
          {t("caption")}
        </p>
        <div
          role="group"
          aria-label={t("range.label")}
          className="inline-flex rounded-md border border-border bg-sunken p-0.5"
        >
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={range === item.key}
              onClick={() => setRange(item.key)}
              className={cn(
                "min-h-8 rounded-sm px-3 font-mono text-xs transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
                range === item.key
                  ? "bg-accent text-on-accent"
                  : "text-fg-secondary hover:bg-hover hover:text-fg"
              )}
            >
              {t(`range.${item.key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-4">
        {KPIS.map((kpi) => {
          const max = Math.max(...kpi.trend);
          const min = Math.min(...kpi.trend);
          const spark = kpi.trend.map((value, index) => ({
            x: (index / (kpi.trend.length - 1)) * 120,
            y: 4 + (1 - (value - min) / Math.max(max - min, 1)) * 28,
          }));
          return (
            <div key={kpi.key} data-card className={cn(cell, "flex flex-col gap-3")}>
              <p className="text-xs text-fg-secondary sm:text-sm">{t(`kpis.${kpi.key}`)}</p>
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                  <span className="sr-only">{format.number(kpi.value)}</span>
                  <span aria-hidden="true" data-count={kpi.value}>
                    {format.number(kpi.value)}
                  </span>
                </p>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 120 36"
                  className="h-8 w-20 shrink-0 overflow-visible"
                >
                  <path
                    data-draw
                    d={linePathOf(spark)}
                    pathLength={1}
                    strokeDasharray="1"
                    fill="none"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    style={{ stroke: kpi.key === "holds" ? HELD : INK }}
                  />
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Area chart */}
        <figure data-card className={cn(cell, "flex flex-col")}>
          <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{t("custody.title")}</span>
            <span className="font-mono text-xs text-fg-tertiary">{t("custody.unit")}</span>
          </figcaption>

          <div className="relative my-auto pt-4">
            <svg
              viewBox={`0 0 ${AREA.width} ${AREA.height}`}
              role="img"
              aria-label={t("custody.summary", {
                from: format.number(values[0] ?? 0),
                to: format.number(values[values.length - 1] ?? 0),
              })}
              className="block h-auto w-full overflow-visible"
            >
              <defs>
                <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: INK, stopOpacity: 0.16 }} />
                  <stop offset="1" style={{ stopColor: INK, stopOpacity: 0 }} />
                </linearGradient>
                <clipPath id={ids.reveal}>
                  <rect
                    data-reveal={AREA.width + 20}
                    x={-10}
                    y={-10}
                    width={AREA.width + 20}
                    height={AREA.height + 20}
                  />
                </clipPath>
              </defs>

              <g aria-hidden="true" className="font-mono text-[10px] max-sm:text-[17px]">
                {[0, 200, 400, 600, 800].map((tick) => {
                  const y =
                    AREA.top + (AREA.height - AREA.top - AREA.bottom) * (1 - tick / AREA.max);
                  return (
                    <g key={tick}>
                      <line
                        x1={AREA.left}
                        x2={AREA.width - AREA.right}
                        y1={y}
                        y2={y}
                        className={tick === 0 ? "stroke-border-strong" : "stroke-border"}
                      />
                      <text
                        x={AREA.left - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-fg-tertiary"
                      >
                        {format.number(tick)}
                      </text>
                    </g>
                  );
                })}
                {points.map((point, index) =>
                  index % (values.length > 8 ? 2 : 1) === 0 ? (
                    <text
                      key={index}
                      x={point.x}
                      y={AREA.height - 8}
                      textAnchor="middle"
                      className="fill-fg-tertiary"
                    >
                      {monthShort(index)}
                    </text>
                  ) : null
                )}
              </g>

              <g clipPath={`url(#${ids.reveal})`}>
                <path data-area-fill d={areaPath} style={{ fill: `url(#${ids.fill})` }} />
              </g>
              <path
                data-area-line
                d={linePath}
                pathLength={1}
                strokeDasharray="1"
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                style={{ stroke: INK }}
              />

              {lastPoint ? (
                <g data-dot>
                  <rect
                    x={lastPoint.x - 3.5}
                    y={lastPoint.y - 3.5}
                    width={7}
                    height={7}
                    className="stroke-bg"
                    strokeWidth={2}
                    style={{ fill: INK }}
                  />
                </g>
              ) : null}

              {hover !== null && points[hover] ? (
                <g aria-hidden="true">
                  <line
                    x1={points[hover].x}
                    x2={points[hover].x}
                    y1={AREA.top}
                    y2={baseline}
                    className="stroke-border-strong"
                  />
                  <rect
                    x={points[hover].x - 4}
                    y={points[hover].y - 4}
                    width={8}
                    height={8}
                    className="stroke-bg"
                    strokeWidth={2}
                    style={{ fill: INK }}
                  />
                </g>
              ) : null}

              <rect
                x={AREA.left}
                y={AREA.top}
                width={AREA.width - AREA.left - AREA.right}
                height={baseline - AREA.top}
                fill="transparent"
                onPointerMove={onAreaMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>

            {hover !== null && points[hover] ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-border-strong bg-raised px-3 py-2 text-xs shadow-md"
                style={{
                  left: `${(points[hover].x / AREA.width) * 100}%`,
                  top: `${(points[hover].y / AREA.height) * 100}%`,
                  marginTop: -12,
                }}
              >
                <p className="font-mono text-fg-tertiary">{monthLong(hover)}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums">
                  {format.number(values[hover] ?? 0)}
                </p>
              </div>
            ) : null}

            <table className="sr-only">
              <caption>{t("custody.title")}</caption>
              <tbody>
                {values.map((value, index) => (
                  <tr key={index}>
                    <th scope="row">{monthLong(index)}</th>
                    <td>{format.number(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>

        <div className="grid gap-px bg-border">
          {/* Donut */}
          <figure data-card className={cn(cell, "flex flex-col")}>
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{t("stages.title")}</span>
              <span className="font-mono text-xs text-fg-tertiary">{t("stages.unit")}</span>
            </figcaption>

            <div className="mt-3 flex items-center gap-5">
              <div className="relative size-28 shrink-0">
                <svg
                  viewBox="0 0 42 42"
                  role="img"
                  aria-label={t("stages.summary", {
                    top: t(`stages.${STAGES[0].key}`),
                    share: format.number(STAGES[0].share / 100, { style: "percent" }),
                  })}
                  className="size-full -rotate-90"
                >
                  <circle
                    cx="21"
                    cy="21"
                    r="15.9155"
                    fill="none"
                    strokeWidth={DONUT_STROKE}
                    className="stroke-sunken"
                  />
                  {STAGE_SEGMENTS.map((item) => (
                    <circle
                      key={item.key}
                      data-segment
                      data-length={item.length}
                      cx="21"
                      cy="21"
                      r="15.9155"
                      fill="none"
                      strokeLinecap="round"
                      strokeWidth={stage === item.key ? DONUT_STROKE + 1.2 : DONUT_STROKE}
                      pathLength={100}
                      strokeDasharray={`${item.length} ${100 - item.length}`}
                      strokeDashoffset={item.offset}
                      style={{
                        stroke: item.color,
                        opacity: stage && stage !== item.key ? 0.25 : 1,
                        filter: stage === item.key ? `drop-shadow(0 0 2px ${item.color})` : "none",
                        transition: "opacity 250ms, stroke-width 250ms, filter 250ms",
                      }}
                    />
                  ))}
                </svg>
                <div
                  aria-hidden="true"
                  className="absolute inset-0 flex flex-col items-center justify-center"
                >
                  <span className="text-xl font-semibold tracking-tight tabular-nums">
                    {activeStage
                      ? format.number(activeStage.share / 100, { style: "percent" })
                      : format.number(UNITS_UNDER_CUSTODY[UNITS_UNDER_CUSTODY.length - 1] ?? 0)}
                  </span>
                  <span className="max-w-22 truncate font-mono text-[0.625rem] text-fg-tertiary">
                    {activeStage ? t(`stages.${activeStage.key}`) : t("stages.total")}
                  </span>
                </div>
              </div>

              <ul className="min-w-0 flex-1 space-y-0.5 text-sm">
                {STAGES.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onPointerEnter={() => setStage(item.key)}
                      onPointerLeave={() => setStage(null)}
                      onFocus={() => setStage(item.key)}
                      onBlur={() => setStage(null)}
                      className="flex min-h-8 w-full items-center gap-2.5 rounded-sm px-2 text-start transition-colors hover:bg-hover motion-reduce:transition-none pointer-coarse:min-h-11"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: item.color, boxShadow: `0 0 0 3px ${item.color}26` }}
                      />
                      <span className="flex-1 text-fg-secondary">{t(`stages.${item.key}`)}</span>
                      <span className="font-mono text-xs tabular-nums">
                        {format.number(item.share / totalLength, { style: "percent" })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </figure>

          {/* Quality results: flat stacked columns, held results in amber on top */}
          <figure data-card className={cell}>
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{t("results.title")}</span>
              <span className="flex items-center gap-3 font-mono text-xs text-fg-tertiary">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2" style={{ background: INK }} />
                  {t("results.free")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2" style={{ background: HELD }} />
                  {t("results.held")}
                </span>
              </span>
            </figcaption>

            <svg
              viewBox={`0 0 ${BARS.width} ${BARS.height}`}
              role="img"
              aria-label={t("results.summary", {
                free: format.number(RESULTS[RESULTS.length - 1]?.free ?? 0),
                held: format.number(RESULTS[RESULTS.length - 1]?.held ?? 0),
              })}
              className="mt-3 block h-auto w-full overflow-visible"
            >
              <g aria-hidden="true" className="font-mono text-[10px] max-sm:text-[12px]">
                {BAR_TICKS.map((tick) => {
                  const y = barBase - scaleBar(tick);
                  return (
                    <g key={tick}>
                      <line
                        x1={BARS.left}
                        x2={BARS.width}
                        y1={y}
                        y2={y}
                        className={tick === 0 ? "stroke-border-strong" : "stroke-border"}
                      />
                      <text
                        x={BARS.left - 6}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-fg-tertiary"
                      >
                        {format.number(tick)}
                      </text>
                    </g>
                  );
                })}
              </g>
              {RESULTS.map((result, index) => {
                const x = BARS.left + slot * index + (slot - BAR_WIDTH) / 2;
                const freeHeight = scaleBar(result.free);
                const heldHeight = Math.max(scaleBar(result.held), 2);
                const top = barBase - freeHeight - heldHeight - 1;
                const active = bar === index;
                const dimmed = bar !== null && !active;
                return (
                  <g
                    key={index}
                    style={{ opacity: dimmed ? 0.35 : 1, transition: "opacity 200ms" }}
                  >
                    <rect
                      data-bar
                      x={x}
                      y={barBase - freeHeight}
                      width={BAR_WIDTH}
                      height={freeHeight}
                      style={{
                        fill: INK,
                        transformBox: "fill-box",
                        transformOrigin: "50% 100%",
                      }}
                    />
                    <rect
                      data-held
                      x={x}
                      y={top}
                      width={BAR_WIDTH}
                      height={heldHeight}
                      style={{
                        fill: HELD,
                        transformBox: "fill-box",
                        transformOrigin: "50% 100%",
                      }}
                    />
                    <text
                      data-month
                      aria-hidden="true"
                      x={x + BAR_WIDTH / 2}
                      y={BARS.height - 6}
                      textAnchor="middle"
                      className={cn(
                        "font-mono text-[10px] transition-colors max-sm:text-[12px]",
                        active ? "fill-fg" : "fill-fg-tertiary"
                      )}
                    >
                      {format.dateTime(
                        monthOf(UNITS_UNDER_CUSTODY.length - RESULTS.length + index),
                        { month: "short", timeZone: "UTC" }
                      )}
                    </text>
                    {active ? (
                      <text
                        aria-hidden="true"
                        x={x + BAR_WIDTH / 2}
                        y={top - 6}
                        textAnchor="middle"
                        className="font-mono text-[10px] font-semibold tabular-nums max-sm:text-[12px]"
                      >
                        <tspan className="fill-fg">{format.number(result.free)}</tspan>
                        <tspan dx={4} style={{ fill: HELD }}>
                          {format.number(result.held)}
                        </tspan>
                      </text>
                    ) : null}
                    <rect
                      aria-hidden="true"
                      x={BARS.left + slot * index}
                      y={0}
                      width={slot}
                      height={BARS.height}
                      fill="transparent"
                      onPointerEnter={() => setBar(index)}
                      onPointerLeave={() => setBar(null)}
                    />
                  </g>
                );
              })}
            </svg>
          </figure>
        </div>
      </div>
    </div>
  );
}
