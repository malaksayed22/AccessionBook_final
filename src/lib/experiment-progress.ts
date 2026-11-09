/**
 * The lifecycle an experiment's units move through, and how long each stage took. Pure, so it is unit
 * tested and shared by the list cards and the experiment page.
 *
 * The lifecycle runs seed, vegetative, flowering, harvested, drying, curing, storage. Seed lots sit at
 * "seed" and cultures have a stage of their own; a unit with no recorded stage says nothing about the
 * timeline and is left out.
 */
export const LIFECYCLE_STAGES = [
  "SEED",
  "VEGETATIVE",
  "FLOWERING",
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Where a unit sits: a lifecycle stage, or one of the two buckets with no place on the line. */
export type StageBucket = LifecycleStage | "CULTURE" | "NONE";

const MS_PER_DAY = 86_400_000;
const ORDER: readonly StageBucket[] = [...LIFECYCLE_STAGES, "CULTURE", "NONE"];

/** Bucket of a unit: seed lots are "SEED", cultures "CULTURE", the rest by their growth stage. */
export function stageBucketOf(type: string, growthStage: string | null): StageBucket {
  if (type === "SEEDLOT") return "SEED";
  if (type === "CULTURE") return "CULTURE";
  return (LIFECYCLE_STAGES as readonly string[]).includes(growthStage ?? "")
    ? (growthStage as LifecycleStage)
    : "NONE";
}

/**
 * One stage of an experiment's timeline: when the first unit entered it, when the last unit left it
 * (null while any unit is still in it), and how many days that took, counted up to `now` while ongoing.
 */
export type StageSpan = {
  stage: StageBucket;
  started: Date;
  ended: Date | null;
  days: number;
};

/** Whole days between two moments, at least 1: a stage that began and ended today took one day. */
export function spanDays(started: Date, ended: Date | null, now: Date): number {
  const end = ended ?? now;
  return Math.max(1, Math.ceil((end.getTime() - started.getTime()) / MS_PER_DAY));
}

/**
 * Merges the rows of one experiment into one span per stage (a seed lot and a plant can both sit in
 * "seed"), in lifecycle order. A stage is ongoing as soon as any of its rows is.
 */
export function buildStageSpans(
  rows: ReadonlyArray<{ stage: StageBucket; started: Date; ended: Date | null }>,
  now: Date,
  /** When the experiment was completed: stages still running then ended with it. */
  completedOn: Date | null = null
): StageSpan[] {
  const merged = new Map<StageBucket, { started: Date; ended: Date | null; ongoing: boolean }>();
  for (const row of rows) {
    if (row.stage === "NONE") continue;
    const current = merged.get(row.stage);
    if (!current) {
      merged.set(row.stage, {
        started: row.started,
        ended: row.ended,
        ongoing: row.ended === null,
      });
      continue;
    }
    if (row.started < current.started) current.started = row.started;
    if (row.ended === null) current.ongoing = true;
    else if (current.ended === null || row.ended > current.ended) current.ended = row.ended;
  }
  return ORDER.flatMap((stage) => {
    const span = merged.get(stage);
    if (!span) return [];
    // A completion on the day a stage began falls before its timestamp: the stage ends where it began.
    const ended = span.ongoing
      ? completedOn
        ? new Date(Math.max(completedOn.getTime(), span.started.getTime()))
        : null
      : span.ended;
    return [{ stage, started: span.started, ended, days: spanDays(span.started, ended, now) }];
  });
}

/** One stage's share of the single timeline bar, as percentages of the bar's width. */
export type StageSegment = { span: StageSpan; left: number; width: number };

const MIN_SEGMENT = 6;

/**
 * Lays the stages out on ONE bar, left to right. A stage runs from the day it started until the next
 * stage started, so the bar is continuous like a batch's life; the last one runs to its own end (or
 * today). Stages that started the same day share that stretch equally, because one bar cannot overlap
 * them; the exact dates and days of every stage are printed beside the bar. Every stage keeps a
 * minimum width so a short one stays visible.
 */
export function stageSegments(spans: readonly StageSpan[], now: Date): StageSegment[] {
  if (spans.length === 0) return [];
  const order = (s: StageSpan) => ORDER.indexOf(s.stage);
  const sorted = [...spans].sort(
    (a, b) => a.started.getTime() - b.started.getTime() || order(a) - order(b)
  );
  const from = sorted[0]!.started.getTime();
  const to = Math.max(...sorted.map((s) => (s.ended ?? now).getTime()), from + MS_PER_DAY);

  const groups: StageSpan[][] = [];
  for (const span of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.started.getTime() === span.started.getTime()) last.push(span);
    else groups.push([span]);
  }

  const raw: Array<{ span: StageSpan; width: number }> = [];
  groups.forEach((group, i) => {
    const start = group[0]!.started.getTime();
    const end = groups[i + 1]?.[0]!.started.getTime() ?? to;
    const slot = Math.max(end - start, 0);
    for (const span of group) raw.push({ span, width: slot / group.length });
  });

  const total = raw.reduce((sum, r) => sum + r.width, 0) || 1;
  const widths = raw.map((r) => Math.max((r.width / total) * 100, MIN_SEGMENT));
  const scale = 100 / widths.reduce((sum, w) => sum + w, 0);
  let left = 0;
  return raw.map((r, i) => {
    const width = widths[i]! * scale;
    const segment = { span: r.span, left, width };
    left += width;
    return segment;
  });
}
