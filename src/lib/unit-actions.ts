import type { UnitType } from "@/generated/prisma/enums";
import type { TerminalKind } from "./unit-profile";

/**
 * What the unit page offers, as one pure function. This only decides what to SHOW: the server
 * enforces every rule again (`features/unit/service.ts`, `features/qa/service.ts`), so a stale page
 * can never do more than the rules allow.
 *
 * An action is `hidden` when the user may never do it here (no permission, or it does not apply to
 * this type of unit), `blocked` when they could but the unit's state forbids it right now (the UI
 * says why), and `allowed` otherwise.
 */
export const UNIT_ACTIONS = [
  "move",
  "stage",
  "measure",
  "waste",
  "ship",
  "derive",
  "split",
  "merge",
  "edit",
  "editDetails",
  "linkParent",
  "hold",
  "releaseHold",
  "destroy",
  "recordTest",
  "sample",
  "reportIncident",
  "reportWeight",
  "upload",
] as const;
export type UnitActionId = (typeof UNIT_ACTIONS)[number];

/** Why a visible action cannot be used now. Translated as `units.detail.blocked.<reason>`. */
export type BlockedReason = "held" | "destroyed" | "shipped" | "weighed";

export type ActionAvailability =
  { status: "allowed" } | { status: "hidden" } | { status: "blocked"; reason: BlockedReason };

export type UnitActionContext = {
  type: UnitType;
  terminal: TerminalKind | null;
  onHold: boolean;
  hasParent: boolean;
  /** Admin, inventory manager, or a member of the unit's experiment. */
  canEdit: boolean;
  isAdmin: boolean;
  /** Holds, lab results and incidents (quality assurance too); defaults to `canEdit`. */
  canRecordQuality?: boolean;
  /** Destruction: administrators and members of the unit's experiment; defaults to `isAdmin`. */
  canDestroy?: boolean;
  /** Releasing a hold (admins and quality assurance); defaults to `isAdmin`. */
  canReleaseHold?: boolean;
  /** Weighed material (a flower, or a plant once harvested): waste can be recorded on it. */
  weighed?: boolean;
  /** Plants in the unit (a plant group); one when not given. */
  plants?: number;
  /** Which weights are on record: once both are, a weight is only changed by an administrator. */
  weights?: { wet: boolean; dry: boolean };
};

/** The actions quality assurance takes on any unit. */
const QUALITY_ACTIONS: ReadonlySet<UnitActionId> = new Set([
  "hold",
  "recordTest",
  "sample",
  "reportIncident",
  "reportWeight",
]);

/** Actions taken out of the unit page for now (see `availabilityOf`). */
const SET_ASIDE: ReadonlySet<UnitActionId> = new Set(["recordTest", "sample"]);

const ALLOWED: ActionAvailability = { status: "allowed" };
const HIDDEN: ActionAvailability = { status: "hidden" };

function blockedByTerminal(terminal: TerminalKind): ActionAvailability {
  return { status: "blocked", reason: terminal === "DESTROYED" ? "destroyed" : "shipped" };
}

/** Actions that change the unit's custody or lifecycle: a hold freezes them. */
const FROZEN_BY_HOLD: ReadonlySet<UnitActionId> = new Set([
  "move",
  "stage",
  "derive",
  "ship",
  "waste",
  "split",
  "merge",
  "destroy",
]);

function appliesToType(action: UnitActionId, type: UnitType): boolean {
  switch (action) {
    case "stage":
      return type === "PLANT" || type === "FLOWER";
    case "measure":
      return type !== "CULTURE";
    case "reportWeight":
      return type === "PLANT" || type === "FLOWER";
    case "derive":
      return type === "PLANT" || type === "CULTURE";
    case "sample":
      // Flowers are sampled by weight, seed lots by count; plants and cultures give tissue samples.
      return true;
    case "split":
    case "merge":
      return type === "PLANT";
    default:
      return true;
  }
}

export function availabilityOf(
  action: UnitActionId,
  context: UnitActionContext
): ActionAvailability {
  // Lab results and samples are set aside for now: each lab panel has its own specification, so a
  // standard form does not fit. Results already on record are still shown.
  if (SET_ASIDE.has(action)) return HIDDEN;
  if (action === "releaseHold") {
    // A quality decision (admins and quality assurance), and only while a hold exists.
    return (context.canReleaseHold ?? context.isAdmin) && context.onHold ? ALLOWED : HIDDEN;
  }
  // Shipping is a custody record: administrators only. Destruction is final: administrators, and
  // members of the unit's experiment.
  if (action === "ship" && !context.isAdmin) return HIDDEN;
  if (action === "destroy" && !(context.canDestroy ?? context.isAdmin)) return HIDDEN;
  if (action === "edit" && context.terminal === "DESTROYED") {
    // The one edit after destruction: notes, by an admin.
    return context.isAdmin ? ALLOWED : HIDDEN;
  }
  const may = QUALITY_ACTIONS.has(action)
    ? (context.canRecordQuality ?? context.canEdit)
    : context.canEdit;
  if (!may || !appliesToType(action, context.type)) return HIDDEN;
  if (action === "waste" && !context.weighed) return HIDDEN;
  // Only a group of two or more plants can split.
  if (action === "split" && (context.plants ?? 1) < 2) return HIDDEN;
  if (action === "linkParent" && context.hasParent) return HIDDEN;
  if (action === "hold" && context.onHold) return HIDDEN;
  const weights = context.weights ?? { wet: false, dry: false };
  // A weight already on record is not changed from the unit page: a mistake is reported as an
  // incident to the administrators.
  if (action === "reportWeight" && (context.isAdmin || (!weights.wet && !weights.dry))) {
    return HIDDEN;
  }
  if (context.terminal) return blockedByTerminal(context.terminal);
  if (context.onHold && FROZEN_BY_HOLD.has(action)) return { status: "blocked", reason: "held" };
  if (
    action === "measure" &&
    (context.type === "PLANT" || context.type === "FLOWER") &&
    weights.wet &&
    weights.dry
  ) {
    return { status: "blocked", reason: "weighed" };
  }
  return ALLOWED;
}

export function availabilityMap(
  context: UnitActionContext
): Record<UnitActionId, ActionAvailability> {
  return Object.fromEntries(UNIT_ACTIONS.map((a) => [a, availabilityOf(a, context)])) as Record<
    UnitActionId,
    ActionAvailability
  >;
}
