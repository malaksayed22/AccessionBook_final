import { PLANT_STAGE_SEQUENCE, type LifecycleStageId } from "./lifecycle-stages";

/** The slice of a `UnitState` that stage accounting needs. */
export type StageStateLike = {
  sequence: number;
  kind: string;
  growthStage: string | null;
  effectiveAt: Date;
};

/** A stage change derived from consecutive `STAGE_CHANGED` events. */
export type StageChange<T extends StageStateLike = StageStateLike> = {
  state: T;
  fromStage: string | null;
  toStage: string;
  /** Filed after an event with a later effective date: only a back-dated entry can be. */
  backDated: boolean;
};

/** One contiguous stay in a stage. Names are the UI's job (`domain.growthStage.<id>`): this carries the id. */
export type StageSpan = {
  stage: LifecycleStageId;
  start: Date;
  end: Date | null;
  days: number;
  ongoing: boolean;
};

const MS_PER_DAY = 86_400_000;

export function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
}

function isTrackedStage(stage: string): stage is LifecycleStageId {
  return (PLANT_STAGE_SEQUENCE as string[]).includes(stage);
}

function bySequence<T extends { sequence: number }>(states: readonly T[]): T[] {
  return [...states].sort((a, b) => a.sequence - b.sequence);
}

/**
 * The `STAGE_CHANGED` events of a unit with their from/to stage, oldest first. The "from" stage is
 * the growth stage carried by the event recorded just before (by sequence, not by date).
 */
export function deriveStageChanges<T extends StageStateLike>(
  states: readonly T[]
): StageChange<T>[] {
  const changes: StageChange<T>[] = [];
  let previous: T | null = null;
  let latestEffective = -Infinity;
  for (const state of bySequence(states)) {
    if (state.kind === "STAGE_CHANGED" && state.growthStage) {
      changes.push({
        state,
        fromStage: previous?.growthStage ?? null,
        toStage: state.growthStage,
        backDated: state.effectiveAt.getTime() < latestEffective,
      });
    }
    latestEffective = Math.max(latestEffective, state.effectiveAt.getTime());
    previous = state;
  }
  return changes;
}

export type StageSpanOptions = {
  now?: Date;
  /**
   * When the unit left inventory (SHIPPED / DESTROYED `effectiveAt`). The last span then ends there
   * instead of running on to `now`.
   */
  endedAt?: Date | null;
};

type StagePoint = { stage: LifecycleStageId; date: Date; sequence: number };

/**
 * Turns a unit's events into contiguous stage spans.
 *
 * The first event (CREATED / RECEIVED) supplies the initial stage; every `STAGE_CHANGED` event
 * supplies a new one. Points are ordered by `effectiveAt` because operators may back-date a
 * correction, with the recording sequence breaking ties. Repeated entries into the same stage in a
 * row are merged. The final span is open (`ongoing`) and measured against `now` — that is what
 * makes "day 34 of flowering" possible — unless the unit has left inventory, in which case it ends
 * at `endedAt`.
 */
export function buildStageSpans(
  states: readonly StageStateLike[],
  options: StageSpanOptions = {}
): StageSpan[] {
  const now = options.now ?? new Date();
  const ordered = bySequence(states);

  const points: StagePoint[] = [];
  const first = ordered[0];
  if (first?.growthStage && isTrackedStage(first.growthStage)) {
    points.push({ stage: first.growthStage, date: first.effectiveAt, sequence: first.sequence });
  }
  for (const state of ordered) {
    if (state.kind !== "STAGE_CHANGED" || !state.growthStage) continue;
    if (!isTrackedStage(state.growthStage)) continue;
    points.push({ stage: state.growthStage, date: state.effectiveAt, sequence: state.sequence });
  }
  points.sort((a, b) => a.date.getTime() - b.date.getTime() || a.sequence - b.sequence);

  const merged = points.filter((point, index) => points[index - 1]?.stage !== point.stage);
  const endedAt = options.endedAt ?? null;

  return merged.map((point, index) => {
    const next = merged[index + 1];
    const end = next ? next.date : endedAt;
    return {
      stage: point.stage,
      start: point.date,
      end,
      days: daysBetween(point.date, end ?? now),
      ongoing: !next && !endedAt,
    };
  });
}

export type StageDurationSummary = {
  spans: StageSpan[];
  totals: Partial<Record<LifecycleStageId, number>>;
  /** The span the unit is in right now; null once it has left inventory. */
  current: StageSpan | null;
  totalDays: number;
};

/** Sums repeat visits to a stage (a plant can be re-vegged, for example). */
export function summarizeStageDurations(
  states: readonly StageStateLike[],
  options: StageSpanOptions = {}
): StageDurationSummary {
  const spans = buildStageSpans(states, options);
  const totals: Partial<Record<LifecycleStageId, number>> = {};

  for (const span of spans) {
    totals[span.stage] = (totals[span.stage] ?? 0) + span.days;
  }

  const last = spans[spans.length - 1];
  const current = last?.ongoing ? last : null;
  const totalDays = spans.reduce((sum, span) => sum + span.days, 0);

  return { spans, totals, current, totalDays };
}

/** The stages the unit profile shows a day counter for, in lifecycle order. */
export const DURATION_STAGES: readonly LifecycleStageId[] = [
  "VEGETATIVE",
  "FLOWERING",
  "DRYING",
  "CURING",
  "STORAGE",
];
