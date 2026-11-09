import { STAGE_OPTION_IDS, type StageOptionId } from "./unit-action-constants";

/**
 * Growth stages only move forward: a plant goes vegetative, flowering, harvested, drying, curing,
 * storage (seed last), and never back. Pure, so the forms and the service share one rule.
 */
export const STAGE_ORDER: readonly StageOptionId[] = STAGE_OPTION_IDS;

/** The stages a unit in `current` can move to; every stage when none is recorded yet. */
export function laterStages(current: string | null | undefined): StageOptionId[] {
  const index = current ? STAGE_ORDER.indexOf(current as StageOptionId) : -1;
  return STAGE_ORDER.slice(index + 1);
}

/** Whether moving from `current` to `next` goes forward. */
export function isLaterStage(current: string | null | undefined, next: string): boolean {
  return laterStages(current).includes(next as StageOptionId);
}
