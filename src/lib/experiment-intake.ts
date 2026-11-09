/**
 * Describes the material a new experiment starts with. Shared by the new-experiment wizard and the
 * create-experiment service so both sides agree on what is valid.
 *
 * The catalog holds identifiers only. Names shown to people live in `messages/<locale>/experiments.json`
 * (`wizard.kinds.<id>`) and `domain.json` (`growthStage.<id>`); validation returns issue codes the UI
 * translates. The English sentences produced by `validateIntake` exist for the server's fallback
 * error text and for non-browser clients, exactly like the other service error messages.
 */

/**
 * The product sets no limit on how many units a group holds. This is only a safeguard against a
 * typo (an extra zero) turning one request into millions of rows.
 */
export const MAX_GROUP_QUANTITY = 100_000;
export const MAX_INTAKE_UNITS = 100_000;

export type IntakeKindId = "SEEDS" | "CLONES" | "PLANTS" | "CULTURES" | "FLOWERS";

export type IntakeKind = {
  id: IntakeKindId;
  unitType: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE";
  sourceType: string;
  /** Growth stages a unit of this kind can start in (ids of `domain.growthStage`). */
  stages: readonly string[];
  tracksSeedCount?: boolean;
  tracksWeight?: boolean;
};

const PLANT_STAGES = ["VEGETATIVE", "FLOWERING", "HARVESTED"] as const;
const FLOWER_STAGES = ["HARVESTED", "DRYING", "CURING", "STORAGE"] as const;

export const INTAKE_KINDS: readonly IntakeKind[] = [
  { id: "SEEDS", unitType: "SEEDLOT", sourceType: "SEED", stages: [], tracksSeedCount: true },
  { id: "CLONES", unitType: "PLANT", sourceType: "CLONE", stages: PLANT_STAGES },
  { id: "PLANTS", unitType: "PLANT", sourceType: "RECEIVED", stages: PLANT_STAGES },
  { id: "CULTURES", unitType: "CULTURE", sourceType: "SUBCULTURE", stages: [] },
  {
    id: "FLOWERS",
    unitType: "FLOWER",
    sourceType: "HARVEST",
    stages: FLOWER_STAGES,
    tracksWeight: true,
  },
];

export function findIntakeKind(id: string): IntakeKind | undefined {
  return INTAKE_KINDS.find((k) => k.id === id);
}

export function suggestedKindForUnitType(unitType: string): IntakeKindId {
  switch (unitType) {
    case "SEEDLOT":
      return "SEEDS";
    case "FLOWER":
      return "FLOWERS";
    case "CULTURE":
      return "CULTURES";
    case "PLANT":
    default:
      return "CLONES";
  }
}

export type IntakeStatusSplit = { status: string; count: number };
export type IntakeCultivarSplit = { cultivarId: number; count: number };

export type ProviderMode = "INTERNAL" | "EXTERNAL";

export type IntakeGroupInput = {
  kind: string;
  cultivarId: number | null;
  cultivarMode?: "SAME" | "MIXED";
  cultivarBreakdown?: IntakeCultivarSplit[];
  quantity: number;
  statusMode: "SAME" | "MIXED";
  status?: string | null;
  breakdown?: IntakeStatusSplit[];
  seedsPerLot?: number | null;
  wetWeightGrams?: number | null;
  dryWeightGrams?: number | null;
};

export type IntakeInput = {
  locationId: number | null;
  providerMode?: ProviderMode;
  providerOrganizationId: number | null;
  sourceDescription?: string | null;
  groups: IntakeGroupInput[];
};

export type ExpandedIntakeUnit = {
  stage: string | null;
  cultivarId: number;
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function totalIntakeUnits(groups: IntakeGroupInput[]): number {
  return groups.reduce((sum, g) => sum + (Number(g.quantity) || 0), 0);
}

// --- Validation ---------------------------------------------------------------------------------

/** What went wrong, as data. The wizard translates `code`; `describeIntakeIssue` is the English text. */
export type IntakeIssueCode =
  | "location_required"
  | "supplier_required"
  | "too_many_units"
  | "unknown_kind"
  | "quantity_invalid"
  | "cultivar_required"
  | "cultivar_split_missing"
  | "cultivar_split_invalid"
  | "cultivar_split_count"
  | "cultivar_split_sum"
  | "status_required"
  | "status_split_missing"
  | "status_split_invalid"
  | "status_split_count"
  | "status_split_sum"
  | "seeds_invalid"
  | "weight_wet_invalid"
  | "weight_dry_invalid"
  | "weight_required";

export type IntakeIssue = {
  code: IntakeIssueCode;
  /** Zero-based unit group the issue belongs to; absent for issues about the experiment's intake. */
  group?: number;
  /** Numbers and names the message needs. */
  params?: { total?: number; max?: number; sum?: number; quantity?: number; status?: string };
};

type SplitCheck = {
  missing: IntakeIssueCode;
  invalid: IntakeIssueCode;
  count: IntakeIssueCode;
  sum: IntakeIssueCode;
};

const CULTIVAR_SPLIT: SplitCheck = {
  missing: "cultivar_split_missing",
  invalid: "cultivar_split_invalid",
  count: "cultivar_split_count",
  sum: "cultivar_split_sum",
};
const STATUS_SPLIT: SplitCheck = {
  missing: "status_split_missing",
  invalid: "status_split_invalid",
  count: "status_split_count",
  sum: "status_split_sum",
};

function checkBreakdown<T extends { count: number }>(
  group: number,
  codes: SplitCheck,
  quantity: number,
  splits: T[],
  entryInvalid?: (entry: T) => { status?: string } | null
): IntakeIssue | null {
  if (splits.length === 0) return { code: codes.missing, group };
  let sum = 0;
  for (const split of splits) {
    const invalid = entryInvalid?.(split);
    if (invalid) {
      return {
        code: codes.invalid,
        group,
        params: invalid.status === undefined ? undefined : { status: invalid.status },
      };
    }
    if (!isPositiveInt(split.count)) return { code: codes.count, group };
    sum += split.count;
  }
  if (sum !== quantity) return { code: codes.sum, group, params: { sum, quantity } };
  return null;
}

/**
 * Issues with where the units are held and where the material came from. The material source is
 * always required (internal, or an external supplier); the location only matters with starting units.
 * Describing an internal source is optional.
 */
export function findSourceIssue(input: IntakeInput): IntakeIssue | null {
  if ((input.groups ?? []).length > 0 && !input.locationId) return { code: "location_required" };

  const mode = input.providerMode ?? (input.providerOrganizationId ? "EXTERNAL" : "INTERNAL");
  if (mode === "EXTERNAL" && !input.providerOrganizationId) return { code: "supplier_required" };
  return null;
}

/** The first problem with one unit group, or null. */
export function findGroupIssue(group: IntakeGroupInput, index: number): IntakeIssue | null {
  const kind = findIntakeKind(group.kind);
  if (!kind) return { code: "unknown_kind", group: index };
  if (!isPositiveInt(group.quantity) || group.quantity > MAX_GROUP_QUANTITY) {
    return { code: "quantity_invalid", group: index, params: { max: MAX_GROUP_QUANTITY } };
  }

  const cultivarMode = group.cultivarMode ?? "SAME";
  if (cultivarMode === "MIXED") {
    const splits = (group.cultivarBreakdown ?? []).filter((s) => (s.count ?? 0) > 0);
    const issue = checkBreakdown(index, CULTIVAR_SPLIT, group.quantity, splits, (split) =>
      isPositiveInt(split.cultivarId) ? null : {}
    );
    if (issue) return issue;
  } else if (!group.cultivarId) {
    return { code: "cultivar_required", group: index };
  }

  if (kind.stages.length > 0) {
    const allowed = new Set(kind.stages);
    if (group.statusMode === "MIXED") {
      const splits = (group.breakdown ?? []).filter((s) => (s.count ?? 0) > 0);
      const issue = checkBreakdown(index, STATUS_SPLIT, group.quantity, splits, (split) =>
        allowed.has(split.status) ? null : { status: split.status }
      );
      if (issue) return issue;
    } else if (!group.status || !allowed.has(group.status)) {
      return { code: "status_required", group: index };
    }
  }

  if (kind.tracksSeedCount && group.seedsPerLot != null && !isPositiveInt(group.seedsPerLot)) {
    return { code: "seeds_invalid", group: index };
  }

  if (kind.tracksWeight) {
    const wet = group.wetWeightGrams;
    if (wet != null && (typeof wet !== "number" || !(wet >= 0))) {
      return { code: "weight_wet_invalid", group: index };
    }
    const dry = group.dryWeightGrams;
    if (dry != null && (typeof dry !== "number" || !(dry >= 0))) {
      return { code: "weight_dry_invalid", group: index };
    }
    // Harvested material is reported to Health Canada by weight: it is weighed when it is registered.
    if (wet == null && dry == null) return { code: "weight_required", group: index };
  }
  return null;
}

/** The first problem with the whole intake, in the order a person fixes them. */
export function findIntakeIssue(input: IntakeInput): IntakeIssue | null {
  const groups = input.groups ?? [];

  const source = findSourceIssue(input);
  if (source) return source;
  if (groups.length === 0) return null;

  const total = totalIntakeUnits(groups);
  if (total > MAX_INTAKE_UNITS) {
    return { code: "too_many_units", params: { max: MAX_INTAKE_UNITS, total } };
  }

  for (const [index, group] of groups.entries()) {
    const issue = findGroupIssue(group, index);
    if (issue) return issue;
  }
  return null;
}

const ENGLISH_KIND_NAME: Record<IntakeKindId, string> = {
  SEEDS: "seeds",
  CLONES: "clones / cuttings",
  PLANTS: "plants",
  CULTURES: "tissue cultures",
  FLOWERS: "harvested flower",
};

/** English sentence for the server's error text (the browser translates `code` instead). */
export function describeIntakeIssue(issue: IntakeIssue, input?: IntakeInput): string {
  const position = `Unit group ${(issue.group ?? 0) + 1}`;
  const p = issue.params ?? {};
  switch (issue.code) {
    case "location_required":
      return "Location is required when the experiment starts with units";
    case "supplier_required":
      return "Select the external supplier organization, or register it first";
    case "too_many_units":
      return `An experiment can be created with at most ${p.max} units at once (requested ${p.total})`;
    case "unknown_kind":
      return `${position}: unknown material type`;
    case "quantity_invalid":
      return `${position}: quantity must be a whole number of at least 1`;
    case "cultivar_required":
      return `${position}: cultivar is required`;
    case "cultivar_split_missing":
      return `${position}: enter how many units use each cultivar`;
    case "cultivar_split_invalid":
      return `${position}: each cultivar line needs a valid cultivar`;
    case "cultivar_split_count":
      return `${position}: cultivar counts must be whole positive numbers`;
    case "cultivar_split_sum":
      return `${position}: cultivar counts add up to ${p.sum} but the group has ${p.quantity} units`;
    case "status_required":
      return `${position}: select the status shared by all units`;
    case "status_split_missing":
      return `${position}: enter how many units use each status`;
    case "status_split_invalid": {
      const kind = input?.groups[issue.group ?? 0]?.kind;
      const name = kind ? ENGLISH_KIND_NAME[kind as IntakeKindId] : undefined;
      return `${position}: "${p.status ?? ""}" is not a valid status for ${name ?? "this material"}`;
    }
    case "status_split_count":
      return `${position}: status counts must be whole positive numbers`;
    case "status_split_sum":
      return `${position}: status counts add up to ${p.sum} but the group has ${p.quantity} units`;
    case "seeds_invalid":
      return `${position}: seeds per lot must be a whole positive number`;
    case "weight_wet_invalid":
      return `${position}: wet weight must be zero or more grams`;
    case "weight_dry_invalid":
      return `${position}: dry weight must be zero or more grams`;
    case "weight_required":
      return `${position}: enter the wet or dry weight of the harvested flower`;
  }
}

export function validateIntake(input: IntakeInput): string | null {
  const issue = findIntakeIssue(input);
  return issue ? describeIntakeIssue(issue, input) : null;
}

// --- Expansion ----------------------------------------------------------------------------------

function expandStages(group: IntakeGroupInput): Array<string | null> {
  const kind = findIntakeKind(group.kind);
  if (!kind || kind.stages.length === 0) {
    return Array.from({ length: group.quantity }, () => null);
  }
  if (group.statusMode === "MIXED") {
    const stages: Array<string | null> = [];
    for (const split of group.breakdown ?? []) {
      for (let i = 0; i < split.count; i++) stages.push(split.status);
    }
    return stages;
  }
  return Array.from({ length: group.quantity }, () => group.status ?? null);
}

function expandCultivars(group: IntakeGroupInput): number[] {
  const mode = group.cultivarMode ?? "SAME";
  if (mode === "MIXED") {
    const ids: number[] = [];
    for (const split of group.cultivarBreakdown ?? []) {
      for (let i = 0; i < split.count; i++) ids.push(split.cultivarId);
    }
    return ids;
  }
  return Array.from({ length: group.quantity }, () => group.cultivarId!);
}

/** One entry per unit to create, in the order codes will be assigned. */
export function expandIntakeUnits(group: IntakeGroupInput): ExpandedIntakeUnit[] {
  const stages = expandStages(group);
  const cultivars = expandCultivars(group);
  return stages.map((stage, index) => ({
    stage,
    cultivarId: cultivars[index] ?? group.cultivarId!,
  }));
}
