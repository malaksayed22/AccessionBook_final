import type { UnitType } from "@/generated/prisma/enums";
import { isLaterStage } from "./stage-order";

/**
 * Which of the selected units a bulk action can take, decided from what the list already knows. Like
 * `unit-actions.ts` this only decides what to SHOW and which ids to send: the server checks every
 * unit again and refuses the whole batch if one cannot take the action.
 */
export const BULK_ACTIONS = ["move", "stage", "activity", "hold", "release", "destroy"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export type BulkUnit = {
  id: number;
  name: string;
  type: UnitType;
  status: "active" | "on-hold" | "destroyed";
  /** Everything was shipped: still on record, nothing left to act on. */
  nothingLeft?: boolean;
  locationId: number | null;
  growthStage: string | null;
};

/** What the person chose in the form, which can rule out more units (already there, already in it). */
export type BulkChoice = { toLocationId?: number | null; toStage?: string | null };

/** Why a selected unit is left out. Translated as `units.bulk.skipped.<reason>`. */
export type SkipReason =
  | "held"
  | "notHeld"
  | "destroyed"
  | "shipped"
  | "notApplicable"
  | "alreadyThere"
  | "alreadyInStage"
  | "earlierStage";

export function skipReason(
  action: BulkAction,
  unit: BulkUnit,
  choice: BulkChoice = {}
): SkipReason | null {
  if (unit.status === "destroyed") return "destroyed";
  // Releasing is the one action that needs a hold; a unit with nothing left can still be released.
  if (action === "release") return unit.status === "on-hold" ? null : "notHeld";
  if (unit.nothingLeft) return "shipped";
  // A held plant is still tended (and may be treated), so an activity is recorded on it too.
  if (action === "activity") return null;
  // A unit already on hold cannot be held again, and a hold freezes every other action.
  if (unit.status === "on-hold") return "held";
  if (action === "stage" && unit.type !== "PLANT" && unit.type !== "FLOWER") return "notApplicable";
  if (action === "move" && choice.toLocationId && unit.locationId === choice.toLocationId) {
    return "alreadyThere";
  }
  if (action === "stage" && choice.toStage && unit.growthStage === choice.toStage) {
    return "alreadyInStage";
  }
  // Stages only move forward: a unit already past the chosen stage cannot go back to it.
  if (action === "stage" && choice.toStage && !isLaterStage(unit.growthStage, choice.toStage)) {
    return "earlierStage";
  }
  return null;
}

export type BulkPlan = {
  eligible: BulkUnit[];
  /** How many selected units are left out, per reason. */
  skipped: Partial<Record<SkipReason, number>>;
  skippedCount: number;
};

export function planBulk(
  action: BulkAction,
  selected: readonly BulkUnit[],
  choice: BulkChoice = {}
): BulkPlan {
  const eligible: BulkUnit[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  let skippedCount = 0;
  for (const unit of selected) {
    const reason = skipReason(action, unit, choice);
    if (reason === null) {
      eligible.push(unit);
    } else {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      skippedCount += 1;
    }
  }
  return { eligible, skipped, skippedCount };
}
