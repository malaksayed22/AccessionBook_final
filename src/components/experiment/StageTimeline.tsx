import { useFormatter, useTranslations } from "next-intl";
import { stageSegments, type StageSpan } from "@/lib/experiment-progress";

/** One solid colour per stage, in the hues of our chart palette. */
const STAGE_COLOR: Record<string, string> = {
  SEED: "#d79a2b",
  VEGETATIVE: "#3f5fd0",
  FLOWERING: "#7a63d0",
  HARVESTED: "#2a9d8f",
  DRYING: "#4aa3df",
  CURING: "#5a4fb0",
  STORAGE: "#8793b0",
  CULTURE: "#d3567c",
};
const colorOf = (stage: string) => STAGE_COLOR[stage] ?? "#8793b0";

/** Share of a card's bar that one character of a date takes. */
const CHAR_SHARE = 2.1;

type Mark = { at: number; text: string; align: "start" | "end" | "center"; row: number };

/** Height of one row of dates above the bar, in pixels. */
const ROW = 16;
const ROWS = 2;

/**
 * The stages of an experiment on ONE slim bar like the other two, in the order they happened: the day
 * each stage started above its segment on a tick, the last day at the right end ("ongoing" while units
 * are still in the last stage), and a legend under the bar with every stage and its days. The accessible
 * name carries the dates too, so nothing depends on colour or width. Server friendly.
 */
export function StageTimeline({
  spans,
  now,
  detail = false,
}: {
  spans: readonly StageSpan[];
  now: Date;
  /** Also print each stage's first and last day in the legend under the bar. */
  detail?: boolean;
}) {
  const t = useTranslations("experiments.bars");
  const domain = useTranslations("domain");
  const format = useFormatter();
  const day = (date: Date) =>
    format.dateTime(date, { year: "numeric", month: "short", day: "numeric" });
  const name = (span: StageSpan) => domain(`growthStage.${span.stage as "VEGETATIVE"}`);

  if (spans.length === 0) return <p className="text-sm text-fg-secondary">{t("noTimeline")}</p>;

  const segments = stageSegments(spans, now);
  const sequence = segments.map((s) => s.span);
  // Dates above the bar, each on a tick: the day a stage started and the day it ended. Where one stage
  // ends and the next begins they share a tick, with the end date to its left and the start date to
  // its right (once, when it is the same day). Marks go on one of two rows and the first and last are
  // placed first; one that would overlap another on both rows is left out (the legend and the
  // accessible name still carry every stage).
  const short = (date: Date) => format.dateTime(date, { month: "short", day: "numeric" });
  const n = segments.length;
  const candidates: Array<Omit<Mark, "row"> & { boundary: number }> = [];
  for (let b = 0; b <= n; b += 1) {
    const edge = b === 0 || b === n;
    const at = b === 0 ? 0 : b === n ? 100 : segments[b]!.left;
    const before = b > 0 ? segments[b - 1]!.span : null;
    const after = b < n ? segments[b]!.span : null;
    const endText = before
      ? before.ended
        ? edge
          ? day(before.ended)
          : short(before.ended)
        : b === n
          ? t("ongoing")
          : null
      : null;
    const startText = after ? (edge ? day(after.started) : short(after.started)) : null;
    if (endText && startText && endText === startText) {
      candidates.push({ boundary: b, at, text: startText, align: "center" });
      continue;
    }
    if (endText) candidates.push({ boundary: b, at, text: endText, align: "end" });
    if (startText) candidates.push({ boundary: b, at, text: startText, align: "start" });
  }
  const extent = (m: { at: number; text: string; align: Mark["align"] }): [number, number] => {
    const w = m.text.length * CHAR_SHARE;
    return m.align === "start"
      ? [m.at, m.at + w]
      : m.align === "end"
        ? [m.at - w, m.at]
        : [m.at - w / 2, m.at + w / 2];
  };
  const marks: Mark[] = [];
  // A mark fits a row if its text clears the row's other texts and no tick of an upper row cuts it.
  const free = (m: Omit<Mark, "row">, row: number) =>
    marks.every((other) => {
      const [a1, a2] = extent(m);
      const [b1, b2] = extent(other);
      if (other.row === row) return a2 + 1 <= b1 || b2 + 1 <= a1;
      const [upper, lower, [l1, l2]] =
        other.row < row ? [other, m, [a1, a2]] : [m, other, [b1, b2]];
      return upper.at <= l1 + 0.8 || upper.at >= l2 - 0.8 || lower.at === upper.at;
    });
  const order = [...candidates].sort(
    (x, y) =>
      Number(y.boundary === 0 || y.boundary === n) - Number(x.boundary === 0 || x.boundary === n) ||
      x.boundary - y.boundary
  );
  for (const m of order) {
    const preferred = m.boundary % ROWS;
    const row = [preferred, (preferred + 1) % ROWS].find((r) => free(m, r));
    if (row !== undefined) marks.push({ ...m, row });
  }
  const rows = marks.reduce((max, m) => Math.max(max, m.row + 1), 1);

  return (
    <div>
      <div
        role="img"
        aria-label={`${t("stageTimeline")}: ${sequence
          .map(
            (span) =>
              `${name(span)}, ${day(span.started)} – ${span.ended ? day(span.ended) : t("ongoing")}, ${t("days", { count: span.days })}`
          )
          .join("; ")}`}
      >
        <div aria-hidden="true" className="relative" style={{ height: rows * ROW + 6 }}>
          {marks.map((mark) => (
            <span key={`${mark.at}-${mark.align}-${mark.text}`}>
              <span
                className="absolute whitespace-nowrap text-xs leading-4 text-fg-secondary tabular-nums"
                style={{
                  left: `${mark.at}%`,
                  top: mark.row * ROW,
                  transform:
                    mark.align === "end"
                      ? "translateX(-100%)"
                      : mark.align === "center"
                        ? "translateX(-50%)"
                        : undefined,
                }}
              >
                {mark.text}
              </span>
              <span
                className="absolute bottom-0 w-px bg-fg-tertiary"
                style={{ left: `${mark.at}%`, top: mark.row * ROW + ROW }}
              />
            </span>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-sunken"
        >
          {segments.map(({ span, width }) => (
            <span
              key={span.stage}
              title={`${name(span)} · ${t("days", { count: span.days })}`}
              className="h-full min-w-1.5 first:rounded-s-full last:rounded-e-full"
              style={{ width: `${width}%`, backgroundColor: colorOf(span.stage) }}
            />
          ))}
        </div>
      </div>
      <ul aria-label={t("stageTimeline")} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {sequence.map((span) => (
          <li key={span.stage} className="inline-flex items-center gap-1.5 text-fg-secondary">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorOf(span.stage) }}
            />
            {name(span)}
            {detail ? (
              <span className="text-xs tabular-nums">
                {day(span.started)}
                {" – "}
                {span.ended ? day(span.ended) : t("ongoing")}
              </span>
            ) : null}
            <span className="font-semibold text-fg tabular-nums">
              {t("days", { count: span.days })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
