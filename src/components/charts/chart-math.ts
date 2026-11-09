/**
 * Pure geometry and data helpers for the chart components. No React, no DOM: unit-tested.
 */

/** A linear scale from a data domain onto a pixel range. A zero-width domain maps to the range start. */
export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

/**
 * Clean tick values from 0 up to a "nice" maximum that covers `max`: 1, 2, 2.5 or 5 times a power of
 * ten. Always includes 0 (bars and areas start there, never at a trimmed baseline).
 */
export function niceTicks(max: number, target = 4): number[] {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const rough = safeMax / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const factor =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < safeMax + step - 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
    if (value >= safeMax) break;
  }
  return ticks;
}

/** Evenly spaced band layout: `count` slots across `width`, each bar `barRatio` of its slot, capped. */
export function bandLayout(
  count: number,
  width: number,
  options: { maxBar?: number; barRatio?: number } = {}
) {
  const { maxBar = 24, barRatio = 0.62 } = options;
  const slot = count > 0 ? width / count : width;
  const bar = Math.max(1, Math.min(maxBar, slot * barRatio));
  return {
    slot,
    bar,
    /** Left edge of the bar in slot `index`, centred in its slot. */
    x: (index: number) => index * slot + (slot - bar) / 2,
    /** Centre of slot `index`. */
    center: (index: number) => index * slot + slot / 2,
  };
}

/** Index of the slot a horizontal position falls in, clamped to the valid range. */
export function slotIndexAt(position: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return 0;
  const index = Math.floor((position / width) * count);
  return Math.min(count - 1, Math.max(0, index));
}

/** `YYYY-MM-DD` keys from `from` to `to` inclusive (calendar arithmetic, no time zones involved). */
export function dayKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** Monday of the week containing a `YYYY-MM-DD` key. */
export function weekStartKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Adds `days` to a `YYYY-MM-DD` key. */
export function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Largest stacked or single value across slots; at least 1 so an empty chart still has a scale. */
export function maxOf(values: number[][], stacked: boolean): number {
  let max = 0;
  const slots = Math.max(0, ...values.map((series) => series.length));
  for (let i = 0; i < slots; i++) {
    const column = values.map((series) => series[i] ?? 0);
    max = Math.max(max, stacked ? column.reduce((a, b) => a + b, 0) : Math.max(0, ...column));
  }
  return Math.max(1, max);
}

/** Which slots get an x-axis label so labels never collide: roughly every `n`th, always the last. */
export function labelSlots(count: number, width: number, minLabelWidth = 64): Set<number> {
  const fit = Math.max(1, Math.floor(width / minLabelWidth));
  const every = Math.max(1, Math.ceil(count / fit));
  const slots = new Set<number>();
  for (let i = count - 1; i >= 0; i -= every) slots.add(i);
  return slots;
}

// --- Rings and donuts -------------------------------------------------------------------------------

/** A point on a circle; angle 0 is 12 o'clock and angles grow clockwise. */
export function polar(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
}

/**
 * Angular span of each slice of a full turn, with `gap` radians of air between neighbours (so slices are
 * separated by space, not by a stroke). Zero or negative values get no slice. One slice fills the whole
 * ring without a gap.
 */
export function sliceAngles(
  values: number[],
  gap = 0.03
): Array<{ start: number; end: number } | null> {
  const positive = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = positive.reduce((a, b) => a + b, 0);
  if (total === 0) return positive.map(() => null);
  const visible = positive.filter((v) => v > 0).length;
  const turn = Math.PI * 2;
  const usable = visible > 1 ? turn - gap * visible : turn;
  let cursor = 0;
  return positive.map((value) => {
    if (value === 0) return null;
    const span = (value / total) * usable;
    const slice = {
      start: cursor + (visible > 1 ? gap / 2 : 0),
      end: cursor + (visible > 1 ? gap / 2 : 0) + span,
    };
    cursor += span + (visible > 1 ? gap : 0);
    return slice;
  });
}

/** SVG path for a ring segment between two radii. A full turn is drawn as two halves (arcs cannot close alone). */
export function ringSlicePath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number
): string {
  const span = end - start;
  if (span >= Math.PI * 2 - 1e-6) {
    const mid = start + Math.PI;
    return `${ringSlicePath(cx, cy, outer, inner, start, mid)} ${ringSlicePath(cx, cy, outer, inner, mid, end)}`;
  }
  const large = span > Math.PI ? 1 : 0;
  const a = polar(cx, cy, outer, start);
  const b = polar(cx, cy, outer, end);
  const c = polar(cx, cy, inner, end);
  const d = polar(cx, cy, inner, start);
  const f = (n: number) => Number(n.toFixed(3));
  return `M${f(a.x)},${f(a.y)} A${outer},${outer} 0 ${large} 1 ${f(b.x)},${f(b.y)} L${f(c.x)},${f(c.y)} A${inner},${inner} 0 ${large} 0 ${f(d.x)},${f(d.y)} Z`;
}
