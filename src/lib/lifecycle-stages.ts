export const LIFECYCLE_STAGES = [
  { id: "VEGETATIVE", label: "Vegetative", color: "#3f5fd0" },
  { id: "FLOWERING", label: "Flowering", color: "#7a63d0" },
  { id: "HARVESTED", label: "Harvested", color: "#2a9d8f" },
  { id: "DRYING", label: "Drying", color: "#4aa3df" },
  { id: "CURING", label: "Curing", color: "#5a4fb0" },
  { id: "STORAGE", label: "Storage", color: "#9aa8c8" },
  { id: "SEED", label: "Seed", color: "#d79a2b" },
  { id: "CULTURE", label: "Culture", color: "#d3567c" },
] as const;

export type LifecycleStageId = (typeof LIFECYCLE_STAGES)[number]["id"];

export const STAGE_COLORS: Record<LifecycleStageId, string> = Object.fromEntries(
  LIFECYCLE_STAGES.map((s) => [s.id, s.color])
) as Record<LifecycleStageId, string>;

export const STAGE_LABELS: Record<LifecycleStageId, string> = Object.fromEntries(
  LIFECYCLE_STAGES.map((s) => [s.id, s.label])
) as Record<LifecycleStageId, string>;

/** Stages a plant passes through in order — drives duration accounting. */
export const PLANT_STAGE_SEQUENCE: LifecycleStageId[] = [
  "VEGETATIVE",
  "FLOWERING",
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
];

export function emptyStageCounts(): Record<LifecycleStageId, number> {
  return {
    VEGETATIVE: 0,
    FLOWERING: 0,
    HARVESTED: 0,
    DRYING: 0,
    CURING: 0,
    STORAGE: 0,
    SEED: 0,
    CULTURE: 0,
  };
}

/** A unit with its current state (what `getActiveUnits` returns); weights may be Decimals. */
type UnitLike = {
  type: string;
  currentState?: {
    growthStage?: string | null;
    humidWeight?: unknown;
    dryWeight?: unknown;
  } | null;
};

const DIRECT_STAGE_MAP: Record<string, LifecycleStageId> = {
  VEGETATIVE: "VEGETATIVE",
  FLOWERING: "FLOWERING",
  HARVESTED: "HARVESTED",
  DRYING: "DRYING",
  CURING: "CURING",
  STORAGE: "STORAGE",
  SEED: "SEED",
};

/** The lifecycle bucket a unit currently belongs to, from its type and current state. */
export function deriveLifecycleStageId(unit: UnitLike): LifecycleStageId {
  if (unit.type === "SEEDLOT") return "SEED";
  if (unit.type === "CULTURE") return "CULTURE";

  const state = unit.currentState;
  const stage = state?.growthStage;
  const mapped = stage ? DIRECT_STAGE_MAP[stage] : undefined;

  if (unit.type === "FLOWER") return mapped ?? "HARVESTED";

  if (unit.type === "PLANT") {
    if (mapped) return mapped;
    if (state?.humidWeight != null || state?.dryWeight != null) return "HARVESTED";
    return "VEGETATIVE";
  }

  return "VEGETATIVE";
}

/** Harvested material in any post-harvest stage (what a CTLS return reports in grams). */
export function isPostHarvestStage(stage: LifecycleStageId): boolean {
  return stage === "HARVESTED" || stage === "DRYING" || stage === "CURING" || stage === "STORAGE";
}

export function stageCountsToSegments(
  counts: Record<LifecycleStageId, number>
): Array<{ id: LifecycleStageId; label: string; count: number; color: string }> {
  return LIFECYCLE_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: counts[stage.id],
    color: stage.color,
  }));
}

export function dominantStage(
  counts: Record<LifecycleStageId, number>
): { id: LifecycleStageId; label: string; count: number } | null {
  let best: { id: LifecycleStageId; label: string; count: number } | null = null;
  for (const stage of LIFECYCLE_STAGES) {
    const count = counts[stage.id];
    if (!best || count > best.count) {
      best = { id: stage.id, label: stage.label, count };
    }
  }
  return best && best.count > 0 ? best : null;
}
