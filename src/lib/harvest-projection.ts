/**
 * When a plant (or plant group) is expected to flower and be harvested, and how much it should
 * yield, from its cultivar's typical days per stage and yield per plant. Informational only: it never
 * changes a unit. Pure, so it is unit tested.
 */
export type GrowthProfile = {
  vegetativeDays: number | null;
  floweringDays: number | null;
  expectedYieldGrams: number | null;
};

export type HarvestProjection = {
  /** For a vegetative plant: when it should start flowering. */
  floweringOn: Date | null;
  harvestOn: Date | null;
  /** Dry grams for the whole unit (every plant of a group). */
  expectedYieldGrams: number | null;
};

const MS_PER_DAY = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * MS_PER_DAY);

export function projectHarvest(input: {
  stage: string | null;
  /** When the current stage began. */
  stageSince: Date | null;
  plants: number;
  profile: GrowthProfile | null;
}): HarvestProjection | null {
  const { stage, stageSince, plants, profile } = input;
  if (!profile || !stageSince) return null;
  const expectedYieldGrams =
    profile.expectedYieldGrams === null
      ? null
      : Math.round(profile.expectedYieldGrams * plants * 10) / 10;

  if (stage === "FLOWERING") {
    if (profile.floweringDays === null && expectedYieldGrams === null) return null;
    return {
      floweringOn: null,
      harvestOn: profile.floweringDays === null ? null : addDays(stageSince, profile.floweringDays),
      expectedYieldGrams,
    };
  }
  if (stage === "VEGETATIVE") {
    const floweringOn =
      profile.vegetativeDays === null ? null : addDays(stageSince, profile.vegetativeDays);
    const harvestOn =
      floweringOn && profile.floweringDays !== null
        ? addDays(floweringOn, profile.floweringDays)
        : null;
    if (!floweringOn && !harvestOn && expectedYieldGrams === null) return null;
    return { floweringOn, harvestOn, expectedYieldGrams };
  }
  return null;
}
