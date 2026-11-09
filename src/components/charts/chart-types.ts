/** Colour a series wears. Slots 1-4 are the validated categorical order: never cycle, never generate a 5th. */
export type SeriesColor = "accent" | "1" | "2" | "3" | "4" | "success" | "danger" | "neutral";

export const SERIES_COLOR_VAR: Record<SeriesColor, string> = {
  accent: "var(--color-chart-accent)",
  "1": "var(--color-chart-1)",
  "2": "var(--color-chart-2)",
  "3": "var(--color-chart-3)",
  "4": "var(--color-chart-4)",
  success: "var(--color-success-solid)",
  danger: "var(--color-danger-solid)",
  neutral: "var(--color-border-input)",
};

export type ChartSeries = {
  id: string;
  /** Already translated. */
  label: string;
  color: SeriesColor;
  /** One value per slot, in slot order. */
  values: number[];
};

export type ChartSlot = {
  key: string;
  /** Short axis label, already formatted for the language ("Oct 24"). */
  label: string;
  /** Tooltip heading and screen-reader text ("Saturday, Oct 24, 2026" or "Week of Oct 19"). */
  fullLabel: string;
};

export type ChartData = {
  slots: ChartSlot[];
  series: ChartSeries[];
};
