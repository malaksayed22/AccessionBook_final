import type { GrowthStage, UnitStateKind, UnitType } from "@/generated/prisma/enums";

/**
 * Pure rules behind the unit detail view model. The database reads are in
 * `features/unit/queries.ts`. Nothing here returns an English label: callers get enum values and
 * keys, and the UI translates them.
 */

/** How the material came to be, for the profile header. Translated as `units.detail.material.<key>`. */
export const MATERIAL_CLASSES = [
  "SEED",
  "CUTTING",
  "CULTURE",
  "FLOWER",
  "PLANT",
  "RECEIVED",
] as const;
export type MaterialClass = (typeof MATERIAL_CLASSES)[number];

export function deriveMaterialClass(
  type: UnitType,
  context: { hasParent: boolean; hasProvider: boolean }
): MaterialClass {
  if (type === "SEEDLOT") return "SEED";
  if (type === "CULTURE") return "CULTURE";
  if (type === "FLOWER") return "FLOWER";
  if (context.hasParent) return "CUTTING";
  if (context.hasProvider) return "RECEIVED";
  return "PLANT";
}

const TERMINAL_KINDS: ReadonlySet<UnitStateKind> = new Set(["SHIPPED", "DESTROYED", "MERGED"]);

export type TerminalKind = "SHIPPED" | "DESTROYED" | "MERGED";

/** `SHIPPED`, `DESTROYED` or `MERGED` (a plant group joined another) once nothing is left. */
export function terminalKindOf(kind: UnitStateKind | null | undefined): TerminalKind | null {
  return kind && TERMINAL_KINDS.has(kind) ? (kind as TerminalKind) : null;
}

/** Same values as `UnitStatus` in the domain badges, so the result can go straight to `UnitStatusBadge`. */
export type UnitStatusKey = "active" | "on-hold" | "destroyed";

/**
 * The single status shown on badges: destruction wins over a hold. Shipping is not a status: a unit
 * that shipped (in part or in full) is still active.
 */
export function unitStatusOf(
  kind: UnitStateKind | null | undefined,
  holdKind: "HOLD" | null
): UnitStatusKey {
  if (kind === "DESTROYED") return "destroyed";
  return holdKind ? "on-hold" : "active";
}

/** The slice of a unit event the weight history needs (oldest first). */
export type WeightedState = {
  effectiveAt: Date;
  humidWeight: number | null;
  dryWeight: number | null;
  growthStage: GrowthStage | null;
};

const POST_FLOWERING_STAGES: ReadonlySet<GrowthStage> = new Set([
  "FLOWERING",
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
]);

/**
 * Weights are carried forward from event to event, so the current state holds the latest values;
 * `recordedAt` is the effective date of the event that last changed them.
 */
export function summarizeWeights(
  unitType: UnitType,
  history: readonly WeightedState[]
): {
  humidWeight: number | null;
  dryWeight: number | null;
  /** Effective date of the event that last changed a weight. */
  changedAt: Date | null;
  isHarvested: boolean;
} {
  const current = history[history.length - 1];
  const humidWeight = current?.humidWeight ?? null;
  const dryWeight = current?.dryWeight ?? null;

  let changedAt: Date | null = null;
  if (humidWeight !== null || dryWeight !== null) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const state = history[i];
      const before = history[i - 1];
      if (!state) continue;
      const unchanged =
        before !== undefined &&
        before.humidWeight === state.humidWeight &&
        before.dryWeight === state.dryWeight;
      if (!unchanged) {
        changedAt = state.effectiveAt;
        break;
      }
    }
  }

  const isHarvested =
    unitType === "FLOWER" ||
    humidWeight !== null ||
    dryWeight !== null ||
    history.some((s) => s.growthStage !== null && POST_FLOWERING_STAGES.has(s.growthStage));

  return { humidWeight, dryWeight, changedAt, isHarvested };
}
