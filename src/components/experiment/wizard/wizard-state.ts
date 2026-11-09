import {
  findIntakeKind,
  totalIntakeUnits,
  type IntakeGroupInput,
  type IntakeKindId,
  type ProviderMode,
} from "@/lib/experiment-intake";

/*
 * The new-experiment wizard's state, as plain data. Everything a person types is kept as the text
 * they typed (`quantity: "3"`), so a half-finished form is never rewritten under their fingers; the
 * conversion to the API payload happens once, in `buildPayload`. No React in this file, so the rules
 * are unit tested.
 */

export const WIZARD_STEPS = ["identity", "units", "source", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export type SplitMode = "SAME" | "MIXED";

export type UnitGroup = {
  /** Stable React key; never sent to the server. */
  key: string;
  kind: IntakeKindId;
  /** A group holds several units; otherwise it is one unit and has no quantity to enter. */
  isGroup: boolean;
  quantity: string;
  cultivarMode: SplitMode;
  cultivarId: string;
  /** cultivar id -> count, in the order the person added them. */
  cultivarBreakdown: Record<string, string>;
  statusMode: SplitMode;
  status: string;
  /** growth stage -> count. */
  breakdown: Record<string, string>;
  seedsPerLot: string;
  wetWeightGrams: string;
  dryWeightGrams: string;
};

export type WizardState = {
  name: string;
  startDate: string;
  /** Optional estimate of the day it will be completed, `YYYY-MM-DD` or empty. */
  estimatedEndDate: string;
  comment: string;
  /** Experiment id as text, "" for none. */
  parentExperimentId: string;
  memberIds: number[];
  groups: UnitGroup[];
  nextGroupNumber: number;
  locationId: string;
  providerMode: ProviderMode;
  providerId: string;
  sourceDescription: string;
  /** Record an inbound receipt for the supplier's delivery (external source only). */
  createReceipt: boolean;
  /** The person accepted going over the location's capacity. */
  capacityOverride: boolean;
};

/** Fields the wizard sets one at a time. */
export type WizardField = Exclude<keyof WizardState, "groups" | "nextGroupNumber">;

export type WizardAction =
  | { type: "set"; patch: Partial<Pick<WizardState, WizardField>> }
  | { type: "setProviderMode"; mode: ProviderMode }
  | { type: "addGroup" }
  | { type: "addUnit" }
  | { type: "updateGroup"; key: string; patch: Partial<Omit<UnitGroup, "key">> }
  | { type: "changeKind"; key: string; kind: IntakeKindId }
  | { type: "removeGroup"; key: string }
  | { type: "replace"; state: WizardState };

/** `YYYY-MM-DD` in the viewer's zone, so an evening entry west of UTC does not default to tomorrow. */
export function localDay(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function blankGroup(
  number: number,
  kind: IntakeKindId = "PLANTS",
  isGroup = false
): UnitGroup {
  return {
    key: `g${number}`,
    kind,
    isGroup,
    quantity: "1",
    cultivarMode: "SAME",
    cultivarId: "",
    cultivarBreakdown: {},
    statusMode: "SAME",
    status: "",
    breakdown: {},
    seedsPerLot: "",
    wetWeightGrams: "",
    dryWeightGrams: "",
  };
}

export type WizardSeed = {
  /** Today, as `YYYY-MM-DD`. */
  today: string;
  parentExperimentId?: number;
  /** Pre-filled starting unit when the experiment derives from an existing unit. */
  sourceUnit?: {
    kind: IntakeKindId;
    cultivarId: number | null;
    growthStage: string | null;
    locationId: number | null;
    providerMode: ProviderMode;
    providerOrganizationId: number | null;
    sourceDescription: string | null;
  } | null;
};

export function initialState(seed: WizardSeed): WizardState {
  // A new experiment starts with one unit (not a group); the person can add a group, or remove it.
  const base: WizardState = {
    name: "",
    startDate: seed.today,
    estimatedEndDate: "",
    comment: "",
    parentExperimentId: seed.parentExperimentId ? String(seed.parentExperimentId) : "",
    memberIds: [],
    groups: [blankGroup(0)],
    nextGroupNumber: 1,
    locationId: "",
    providerMode: "INTERNAL",
    providerId: "",
    sourceDescription: "",
    createReceipt: false,
    capacityOverride: false,
  };
  const unit = seed.sourceUnit;
  if (!unit) return base;
  const group = blankGroup(0, unit.kind);
  return {
    ...base,
    locationId: unit.locationId ? String(unit.locationId) : "",
    providerMode: unit.providerMode,
    providerId: unit.providerOrganizationId ? String(unit.providerOrganizationId) : "",
    createReceipt: unit.providerMode === "EXTERNAL",
    sourceDescription: unit.sourceDescription ?? "",
    nextGroupNumber: 1,
    groups: [
      {
        ...group,
        cultivarId: unit.cultivarId ? String(unit.cultivarId) : "",
        status: unit.growthStage ?? group.status,
      },
    ],
  };
}

function updateGroup(state: WizardState, key: string, change: (group: UnitGroup) => UnitGroup) {
  return { ...state, groups: state.groups.map((g) => (g.key === key ? change(g) : g)) };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "set":
      return { ...state, ...action.patch };
    case "setProviderMode":
      return action.mode === "INTERNAL"
        ? { ...state, providerMode: "INTERNAL", providerId: "", createReceipt: false }
        : { ...state, providerMode: "EXTERNAL", createReceipt: true };
    case "addGroup":
      return {
        ...state,
        groups: [...state.groups, blankGroup(state.nextGroupNumber, "PLANTS", true)],
        nextGroupNumber: state.nextGroupNumber + 1,
      };
    case "addUnit":
      return {
        ...state,
        groups: [...state.groups, blankGroup(state.nextGroupNumber)],
        nextGroupNumber: state.nextGroupNumber + 1,
      };
    case "updateGroup":
      return updateGroup(state, action.key, (g) => ({ ...g, ...action.patch }));
    case "changeKind":
      return updateGroup(state, action.key, (g) => ({
        ...g,
        kind: action.kind,
        status: "",
        statusMode: "SAME",
        breakdown: {},
      }));
    case "removeGroup":
      return { ...state, groups: state.groups.filter((g) => g.key !== action.key) };
    case "replace":
      return action.state;
  }
}

// --- API payload ----------------------------------------------------------------------------------

const toCount = (text: string) => Number(text || 0);

export function toIntakeGroup(group: UnitGroup): IntakeGroupInput {
  const kind = findIntakeKind(group.kind);
  return {
    kind: group.kind,
    cultivarId: group.cultivarId ? Number(group.cultivarId) : null,
    cultivarMode: group.isGroup ? group.cultivarMode : "SAME",
    cultivarBreakdown: Object.entries(group.cultivarBreakdown)
      .map(([cultivarId, count]) => ({ cultivarId: Number(cultivarId), count: toCount(count) }))
      .filter((split) => split.cultivarId && split.count > 0),
    quantity: group.isGroup ? toCount(group.quantity) : 1,
    statusMode: group.isGroup ? group.statusMode : "SAME",
    status: group.status || null,
    breakdown: Object.entries(group.breakdown)
      .map(([status, count]) => ({ status, count: toCount(count) }))
      .filter((split) => split.count > 0),
    seedsPerLot: kind?.tracksSeedCount && group.seedsPerLot ? Number(group.seedsPerLot) : null,
    wetWeightGrams:
      kind?.tracksWeight && group.wetWeightGrams ? Number(group.wetWeightGrams) : null,
    dryWeightGrams:
      kind?.tracksWeight && group.dryWeightGrams ? Number(group.dryWeightGrams) : null,
  };
}

export function plannedUnits(state: WizardState): number {
  return totalIntakeUnits(state.groups.map(toIntakeGroup));
}

export type CreateExperimentPayload = {
  name: string;
  startDate: string;
  estimatedEndDate?: string;
  comment?: string;
  parentExperimentId?: number;
  sourceUnitId?: number;
  memberIds?: number[];
  locationId: number | null;
  providerMode: ProviderMode;
  providerOrganizationId: number | null;
  sourceDescription?: string;
  createReceipt: boolean;
  ignoreCapacityWarning: boolean;
  unitGroups: IntakeGroupInput[];
};

/** The body of `POST /api/experiments`, from a state that passed validation. */
export function buildPayload(
  state: WizardState,
  context: { sourceUnitId?: number; admin: boolean }
): CreateExperimentPayload {
  const external = state.providerMode === "EXTERNAL";
  const parent = Number(state.parentExperimentId);
  return {
    name: state.name.trim(),
    startDate: state.startDate,
    estimatedEndDate: state.estimatedEndDate || undefined,
    comment: state.comment.trim() || undefined,
    parentExperimentId: Number.isInteger(parent) && parent > 0 ? parent : undefined,
    sourceUnitId: context.sourceUnitId,
    memberIds: context.admin && state.memberIds.length > 0 ? state.memberIds : undefined,
    locationId: state.locationId ? Number(state.locationId) : null,
    providerMode: state.providerMode,
    providerOrganizationId: external && state.providerId ? Number(state.providerId) : null,
    sourceDescription: state.sourceDescription.trim() || undefined,
    createReceipt: external ? state.createReceipt : false,
    ignoreCapacityWarning: state.capacityOverride,
    unitGroups: state.groups.map(toIntakeGroup),
  };
}

// --- Capacity -------------------------------------------------------------------------------------

export type CapacityCheck =
  | { status: "unlimited" }
  | {
      status: "within" | "full" | "exceeded";
      capacity: number;
      occupancy: number;
      planned: number;
      projected: number;
    };

/** Whether the planned units fit the chosen location. Same arithmetic as the server's check. */
export function checkCapacity(
  location: { capacity: number | null; occupancy: number } | null | undefined,
  planned: number
): CapacityCheck {
  if (!location?.capacity || location.capacity <= 0 || planned <= 0) {
    return { status: "unlimited" };
  }
  const projected = location.occupancy + planned;
  const status =
    projected > location.capacity
      ? "exceeded"
      : projected === location.capacity
        ? "full"
        : "within";
  return {
    status,
    capacity: location.capacity,
    occupancy: location.occupancy,
    planned,
    projected,
  };
}

// --- Draft kept for the browser session -------------------------------------------------------------

export const DRAFT_VERSION = 3;

export type WizardDraft = { version: number; step: WizardStep; state: WizardState };

export function serializeDraft(step: WizardStep, state: WizardState): string {
  const draft: WizardDraft = {
    version: DRAFT_VERSION,
    step,
    // Accepting a capacity override is a decision about one review, never carried to the next.
    state: { ...state, capacityOverride: false },
  };
  return JSON.stringify(draft);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored draft, or null when it is missing, from another version, or not shaped like a draft. */
export function parseDraft(raw: string | null): WizardDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== DRAFT_VERSION) return null;
    const step = WIZARD_STEPS.find((s) => s === parsed.step);
    const state = parsed.state;
    if (!step || !isRecord(state)) return null;
    if (typeof state.name !== "string" || !Array.isArray(state.groups)) return null;
    const groupsOk = state.groups.every(
      (g) =>
        isRecord(g) && typeof g.key === "string" && findIntakeKind(String(g.kind)) !== undefined
    );
    const membersOk =
      Array.isArray(state.memberIds) && state.memberIds.every((id) => Number.isInteger(id));
    if (!groupsOk || !membersOk) return null;
    return { version: DRAFT_VERSION, step, state: state as WizardState };
  } catch {
    return null;
  }
}
