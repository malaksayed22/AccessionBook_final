/**
 * Chart colours, straight from the design tokens so charts follow the light/dark theme. A gradient is
 * a pair of series colours (start, end). They are for marks only, never for text: every chart also
 * prints its figures.
 *
 * Categories take a cool, cohesive set (blue, teal, violet, sky, slate) and are drawn flat (start and
 * end are the same colour), so a chart reads as part of the interface. Only meaning-bearing marks
 * (good, caution, bad) use green, amber and red.
 */
export type Gradient = readonly [from: string, to: string];

export const GRADIENTS = {
  indigo: ["var(--color-series-1)", "var(--color-series-1)"],
  ocean: ["var(--color-series-6)", "var(--color-series-6)"],
  mint: ["var(--color-series-3)", "var(--color-series-3)"],
  sunset: ["var(--color-series-2)", "var(--color-series-2)"],
  orchid: ["var(--color-series-4)", "var(--color-series-4)"],
} as const satisfies Record<string, Gradient>;

/** The order a chart with several unrelated series takes its colours in. */
export const CYCLE: readonly Gradient[] = [
  GRADIENTS.indigo,
  GRADIENTS.mint,
  GRADIENTS.orchid,
  GRADIENTS.ocean,
  GRADIENTS.sunset,
];

/** Meaning-bearing gradients (fine, caution, bad, unknown), always paired with a text label. */
export const STATUS = {
  good: ["var(--color-success-solid)", "var(--color-success-solid)"],
  caution: ["var(--color-warning-solid)", "var(--color-warning-solid)"],
  bad: ["var(--color-danger-solid)", "var(--color-danger-solid)"],
  neutral: ["var(--color-series-2)", "var(--color-series-2)"],
} as const satisfies Record<string, Gradient>;

/** Marks no longer carry a glow: a clean, flat mark reads as more serious. */
export const glow = (color: string, strength = 45) =>
  `color-mix(in srgb, ${color} ${Math.round(strength / 8)}%, transparent)`;
