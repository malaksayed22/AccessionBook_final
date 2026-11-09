import {
  deriveLifecycleStageId,
  dominantStage,
  emptyStageCounts,
  type LifecycleStageId,
} from "./lifecycle-stages";

/** An active unit with its current state: what `getActiveUnits()` returns. */
export type StatsUnit = {
  type: string;
  cultivar?: { id: number } | null;
  experiment?: { id: number } | null;
  currentState?: {
    growthStage?: string | null;
    humidWeight?: unknown;
    dryWeight?: unknown;
    seedCount?: number | null;
    location?: { name: string } | null;
  } | null;
};

export type EntityCardStats = {
  totalUnits: number;
  activeUnits: number;
  destroyedUnits: number;
  stageCounts: Record<LifecycleStageId, number>;
  topLocation: string | null;
  topLocations: Array<{ name: string; count: number }>;
  allLocations: Array<{ name: string; count: number }>;
  seedCount: number;
  typeCounts: Record<string, number>;
  dominantStage: { id: LifecycleStageId; label: string; count: number } | null;
  experimentCount: number;
  hasHarvested: boolean;
  hasPlants: boolean;
  hasDestroyed: boolean;
};

function emptyStats(totalUnits = 0): EntityCardStats {
  return {
    totalUnits,
    activeUnits: 0,
    destroyedUnits: totalUnits,
    stageCounts: emptyStageCounts(),
    topLocation: null,
    topLocations: [],
    allLocations: [],
    seedCount: 0,
    typeCounts: {},
    dominantStage: null,
    experimentCount: 0,
    hasHarvested: false,
    hasPlants: false,
    hasDestroyed: totalUnits > 0,
  };
}

function buildStatsFromUnits(
  units: StatsUnit[],
  totalUnits: number,
  experimentIds?: Set<number>
): EntityCardStats {
  if (units.length === 0) return emptyStats(totalUnits);

  const stageCounts = emptyStageCounts();
  const typeCounts: Record<string, number> = {};
  const locationCounts = new Map<string, number>();
  let seedCount = 0;

  for (const unit of units) {
    const stageId = deriveLifecycleStageId(unit);
    stageCounts[stageId] += 1;

    typeCounts[unit.type] = (typeCounts[unit.type] || 0) + 1;

    const location = unit.currentState?.location?.name;
    if (location) {
      locationCounts.set(location, (locationCounts.get(location) || 0) + 1);
    }

    seedCount += unit.currentState?.seedCount ?? 0;
  }

  const allLocations = [...locationCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const topLocations = allLocations.slice(0, 3);

  const activeUnits = units.length;

  return {
    totalUnits,
    activeUnits,
    destroyedUnits: Math.max(0, totalUnits - activeUnits),
    stageCounts,
    topLocation: topLocations[0]?.name ?? null,
    topLocations,
    allLocations,
    seedCount,
    typeCounts,
    dominantStage: dominantStage(stageCounts),
    experimentCount: experimentIds?.size ?? 0,
    // Drying, curing and storage are all post-harvest, so material sitting in
    // any of them still counts as harvested for the indicator.
    hasHarvested:
      stageCounts.HARVESTED + stageCounts.DRYING + stageCounts.CURING + stageCounts.STORAGE > 0 ||
      (typeCounts.FLOWER ?? 0) > 0,
    hasPlants: (typeCounts.PLANT ?? 0) > 0,
    hasDestroyed: totalUnits > activeUnits,
  };
}

export function buildCultivarStatsMap(
  activeUnits: StatsUnit[],
  cultivarIds: number[],
  totalCounts: Record<number, number>
): Map<number, EntityCardStats> {
  const grouped = new Map<number, StatsUnit[]>();
  const experimentSets = new Map<number, Set<number>>();
  for (const id of cultivarIds) {
    grouped.set(id, []);
    experimentSets.set(id, new Set());
  }

  for (const unit of activeUnits) {
    const cultivarId = unit.cultivar?.id;
    if (!cultivarId || !grouped.has(cultivarId)) continue;
    grouped.get(cultivarId)?.push(unit);
    const expId = unit.experiment?.id;
    if (expId) experimentSets.get(cultivarId)?.add(expId);
  }

  const result = new Map<number, EntityCardStats>();
  for (const id of cultivarIds) {
    const stats = buildStatsFromUnits(
      grouped.get(id) || [],
      totalCounts[id] ?? 0,
      experimentSets.get(id)
    );
    result.set(id, stats);
  }
  return result;
}
