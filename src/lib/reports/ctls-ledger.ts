import type {
  GrowthStage,
  LicenceClass,
  SourceType,
  UnitStateKind,
  UnitType,
} from "@/generated/prisma/enums";
import {
  ADDITION_LINES,
  REDUCTION_LINES,
  TRACKED_CLASS_IDS,
  type CtlsLineId,
  type TrackedClassId,
} from "./ctls-template";

/*
 * Pure arithmetic of the CTLS unpackaged-inventory section, kept free of database code.
 *
 * Every unit state is classified into one form class with a quantity (a `Holding`): seed lots are
 * seeds (count), plants are vegetative or whole plants by stage (one each), harvested material is
 * fresh cannabis at its wet weight until a dry weight is recorded, then dried cannabis at that dry
 * weight. Each event in the month is the difference between the holding before it and after it,
 * booked on the form line the event stands for. Opening and closing come from the states governing
 * at the month's edges, so "closing = opening + additions - reductions" is a real check of the
 * event history, not something true by construction.
 *
 * Weights are counted in whole tenths of a gram (0.0001 kg, the form's precision) so that the lines
 * add up exactly once converted to kilograms.
 */

export type CounterpartyInfo = {
  name: string;
  country: string | null;
  licenceClass: LicenceClass | null;
};

export type LedgerUnit = {
  id: number;
  name: string;
  type: UnitType;
  sourceType: SourceType | null;
  /** Derived from another unit (clone, cutting, subculture, or registered with a parent). */
  hasParent: boolean;
  /** A sample taken from its parent: its material moved, nothing was added. */
  isSample?: boolean;
};

export type LedgerState = {
  stateId: number;
  unitId: number;
  kind: UnitStateKind;
  growthStage: GrowthStage | null;
  /** Grams. */
  humidWeight: number | null;
  /** Grams. */
  dryWeight: number | null;
  seedCount: number | null;
  /** A plant group's number of plants; null means one plant. */
  plantCount?: number | null;
  /** The supplier on RECEIVED, the recipient on SHIPPED / SHIPPED_PART. */
  counterparty: CounterpartyInfo | null;
};

export type Holding = {
  cls: TrackedClassId;
  /** A count, or tenths of a gram. */
  qty: number;
};

export type Movement = {
  stateId: number;
  unitId: number;
  cls: TrackedClassId;
  line: CtlsLineId;
  qty: number;
};

export type ClassLedger = {
  opening: number;
  closing: number;
  lines: Partial<Record<CtlsLineId, number>>;
  reconciles: boolean;
};

export type LedgerIssues = {
  /** Counterparties with no country: treated as Canadian. */
  countryMissing: string[];
  /** Canadian recipients whose licence class has no shipped line: reported under "Other". */
  recipientUnclassified: string[];
  /** Harvested units with no weight at the month's end: their material is in no class. */
  unweighed: string[];
};

export type CtlsLedger = {
  classes: Record<TrackedClassId, ClassLedger>;
  reconciles: boolean;
  /** Tissue cultures have no class on the form; they are counted apart. */
  cultures: { opening: number; added: number; removed: number; closing: number };
  movements: Movement[];
  issues: LedgerIssues;
};

const TERMINAL: ReadonlySet<UnitStateKind> = new Set(["SHIPPED", "DESTROYED", "MERGED"]);
const POST_HARVEST: ReadonlySet<GrowthStage> = new Set([
  "HARVESTED",
  "DRYING",
  "CURING",
  "STORAGE",
]);
/** Registered as made here from material that is not itself a unit (a seed, a cutting, a harvest). */
const PRODUCED_SOURCES: ReadonlySet<SourceType> = new Set([
  "SEED",
  "CUTTING",
  "CLONE",
  "SUBCULTURE",
  "HARVEST",
]);
const WEIGHT_CLASSES: ReadonlySet<TrackedClassId> = new Set(["freshCannabis", "driedCannabis"]);

/** Grams to whole tenths of a gram. */
export const toTenthGrams = (grams: number) => Math.round(grams * 10);
/** Tenths of a gram to kilograms (four decimals). */
export const tenthGramsToKg = (tenths: number) => tenths / 10_000;

function isHarvested(unit: Pick<LedgerUnit, "type">, state: LedgerState): boolean {
  if (unit.type === "FLOWER") return true;
  if (unit.type !== "PLANT") return false;
  if (state.growthStage) return POST_HARVEST.has(state.growthStage);
  // A plant with no stage but a weight is harvested material (as the lifecycle view reads it).
  return state.humidWeight != null || state.dryWeight != null;
}

/** The form class and quantity a unit holds in a state; null when it holds none of them. */
export function holdingOf(unit: Pick<LedgerUnit, "type">, state: LedgerState): Holding | null {
  if (TERMINAL.has(state.kind)) return null;
  switch (unit.type) {
    case "SEEDLOT":
      return { cls: "seeds", qty: state.seedCount ?? 0 };
    case "CULTURE":
      return null;
    case "PLANT":
    case "FLOWER": {
      if (!isHarvested(unit, state)) {
        return {
          cls: state.growthStage === "FLOWERING" ? "wholePlants" : "vegetativePlants",
          qty: state.plantCount ?? 1,
        };
      }
      if (state.dryWeight != null)
        return { cls: "driedCannabis", qty: toTenthGrams(state.dryWeight) };
      if (state.humidWeight != null) {
        return { cls: "freshCannabis", qty: toTenthGrams(state.humidWeight) };
      }
      return null;
    }
  }
}

/** Harvested material without a weight: in no class until it is weighed. */
export function isUnweighedHarvest(unit: Pick<LedgerUnit, "type">, state: LedgerState): boolean {
  return !TERMINAL.has(state.kind) && isHarvested(unit, state) && holdingOf(unit, state) === null;
}

const CANADA = new Set(["canada", "ca", "can"]);

/** "domestic" for Canada, "foreign" for any other country, "unknown" when none is recorded. */
export function countryKind(country: string | null): "domestic" | "foreign" | "unknown" {
  const normal = (country ?? "").normalize("NFD").replace(/[̀-ͯ.]/g, "").trim().toLowerCase();
  if (!normal) return "unknown";
  return CANADA.has(normal) ? "domestic" : "foreign";
}

export type IssueSets = { [K in keyof LedgerIssues]: Set<string> };

function receivedLine(counterparty: CounterpartyInfo | null, issues?: IssueSets): CtlsLineId {
  if (!counterparty) return "additionsOther";
  const kind = countryKind(counterparty.country);
  if (kind === "unknown") issues?.countryMissing.add(counterparty.name);
  return kind === "foreign" ? "receivedImported" : "receivedDomestic";
}

/** The shipped line for a recipient: by country, then by the licence it holds. */
export function shippedLine(counterparty: CounterpartyInfo | null, issues?: IssueSets): CtlsLineId {
  if (!counterparty) return "reductionsOther";
  const kind = countryKind(counterparty.country);
  if (kind === "foreign") return "exported";
  if (kind === "unknown") issues?.countryMissing.add(counterparty.name);
  switch (counterparty.licenceClass) {
    case "ANALYTICAL_TESTING":
      return "shippedTesters";
    case "RESEARCH":
      return "shippedResearchers";
    case "CULTIVATION":
    case "PROCESSING":
      return "shippedCultivators";
    default:
      issues?.recipientUnclassified.add(counterparty.name);
      return "reductionsOther";
  }
}

function additionLine(unit: LedgerUnit, state: LedgerState, issues?: IssueSets): CtlsLineId {
  if (state.kind === "RECEIVED") return receivedLine(state.counterparty, issues);
  if (unit.hasParent || (unit.sourceType && PRODUCED_SOURCES.has(unit.sourceType))) {
    return "produced";
  }
  return "additionsOther";
}

/** A decrease within a class: weight lost to drying or handling; seeds have no such line. */
const lossLine = (cls: TrackedClassId): CtlsLineId =>
  WEIGHT_CLASSES.has(cls) ? "dryingLoss" : "reductionsOther";

/**
 * The form lines one event moves. `before` is undefined for a unit's first event. Counterparties
 * the form cannot place are noted in `issues`.
 */
export function eventMovements(
  unit: LedgerUnit,
  state: LedgerState,
  before: Holding | null | undefined,
  issues?: IssueSets
): Array<Omit<Movement, "stateId" | "unitId">> {
  const after = holdingOf(unit, state);
  const out: Array<Omit<Movement, "stateId" | "unitId">> = [];
  const book = (cls: TrackedClassId, line: CtlsLineId, qty: number) => {
    if (qty !== 0) out.push({ cls, line, qty });
  };

  if (before === undefined) {
    // A sample, or plants split off from a group, moved within inventory: nothing was added.
    const moved = unit.isSample || unit.sourceType === "SPLIT";
    if (after && !moved) book(after.cls, additionLine(unit, state, issues), after.qty);
    return out;
  }
  // Plants moved between groups (a split or a merge): the class holds as many as before.
  if (state.kind === "REGROUPED" || state.kind === "MERGED") return out;
  // Part of the unit became a sample of the same class: the class holds as much as before.
  if (state.kind === "SAMPLED") return out;
  // Part of the unit disposed of as waste: destroyed.
  if (state.kind === "WASTED" && before && after && before.cls === after.cls) {
    book(before.cls, "destroyed", before.qty - after.qty);
    return out;
  }
  if (state.kind === "DESTROYED") {
    if (before) book(before.cls, "destroyed", before.qty);
    return out;
  }
  if (state.kind === "SHIPPED") {
    if (before) book(before.cls, shippedLine(state.counterparty, issues), before.qty);
    return out;
  }
  if (state.kind === "SHIPPED_PART" && before && after && before.cls === after.cls) {
    const shipped = before.qty - after.qty;
    if (shipped > 0) book(before.cls, shippedLine(state.counterparty, issues), shipped);
    else book(before.cls, "additionsOther", -shipped);
    return out;
  }

  // Re-measured, moved, or changed stage.
  if (before && after && before.cls === after.cls) {
    const change = after.qty - before.qty;
    if (change > 0) book(after.cls, "additionsOther", change);
    else book(after.cls, lossLine(after.cls), -change);
    return out;
  }
  if (before && after && WEIGHT_CLASSES.has(before.cls) && WEIGHT_CLASSES.has(after.cls)) {
    // Fresh cannabis dried: what became dried cannabis is processed (and produced on the dried
    // line); the moisture that left is the drying loss.
    book(before.cls, "processed", after.qty);
    const loss = before.qty - after.qty;
    if (loss > 0) book(before.cls, "dryingLoss", loss);
    else book(before.cls, "additionsOther", -loss);
    book(after.cls, "produced", after.qty);
    return out;
  }
  // From one class into another: vegetative to whole plants, a plant harvested into fresh cannabis.
  if (before) book(before.cls, "processed", before.qty);
  if (after) book(after.cls, "produced", after.qty);
  return out;
}

export type LedgerInput = {
  units: ReadonlyMap<number, LedgerUnit>;
  /** Each unit's governing state just before the month (terminal ones included). */
  opening: readonly LedgerState[];
  /** The month's events, ordered by unit, effective time, then sequence. */
  events: readonly LedgerState[];
  /** Each unit's governing state at the month's last instant. */
  closing: readonly LedgerState[];
};

function emptyClasses(): Record<TrackedClassId, ClassLedger> {
  return Object.fromEntries(
    TRACKED_CLASS_IDS.map((id) => [id, { opening: 0, closing: 0, lines: {}, reconciles: true }])
  ) as Record<TrackedClassId, ClassLedger>;
}

export function buildCtlsLedger(input: LedgerInput): CtlsLedger {
  const classes = emptyClasses();
  const cultures = { opening: 0, added: 0, removed: 0, closing: 0 };
  const issues: IssueSets = {
    countryMissing: new Set(),
    recipientUnclassified: new Set(),
    unweighed: new Set(),
  };
  const movements: Movement[] = [];
  const unitOf = (unitId: number) => {
    const unit = input.units.get(unitId);
    if (!unit) throw new Error(`Unit ${unitId} missing from the ledger input`);
    return unit;
  };

  /** Where each unit stands as the month's events are replayed: undefined = not registered yet. */
  const position = new Map<number, { holding: Holding | null; gone: boolean }>();
  for (const state of input.opening) {
    const unit = unitOf(state.unitId);
    const gone = TERMINAL.has(state.kind);
    const holding = holdingOf(unit, state);
    position.set(state.unitId, { holding, gone });
    if (holding) classes[holding.cls].opening += holding.qty;
    if (unit.type === "CULTURE" && !gone) cultures.opening += 1;
  }

  for (const state of input.events) {
    const unit = unitOf(state.unitId);
    const current = position.get(state.unitId);
    // Once a shipment or destruction is effective the unit has left; later events do not count.
    if (current?.gone) continue;
    const gone = TERMINAL.has(state.kind);
    if (unit.type === "CULTURE") {
      if (!current) cultures.added += 1;
      if (gone) cultures.removed += 1;
    }
    for (const movement of eventMovements(unit, state, current?.holding, issues)) {
      const lines = classes[movement.cls].lines;
      lines[movement.line] = (lines[movement.line] ?? 0) + movement.qty;
      movements.push({ stateId: state.stateId, unitId: state.unitId, ...movement });
    }
    position.set(state.unitId, { holding: holdingOf(unit, state), gone });
  }

  for (const state of input.closing) {
    const unit = unitOf(state.unitId);
    const holding = holdingOf(unit, state);
    if (holding) classes[holding.cls].closing += holding.qty;
    if (unit.type === "CULTURE" && !TERMINAL.has(state.kind)) cultures.closing += 1;
    if (isUnweighedHarvest(unit, state)) issues.unweighed.add(unit.name);
  }

  for (const ledger of Object.values(classes)) {
    const added = ADDITION_LINES.reduce((sum, line) => sum + (ledger.lines[line] ?? 0), 0);
    const removed = REDUCTION_LINES.reduce((sum, line) => sum + (ledger.lines[line] ?? 0), 0);
    ledger.reconciles = ledger.opening + added - removed === ledger.closing;
  }

  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return {
    classes,
    reconciles: Object.values(classes).every((c) => c.reconciles),
    cultures,
    movements,
    issues: {
      countryMissing: sorted(issues.countryMissing),
      recipientUnclassified: sorted(issues.recipientUnclassified),
      unweighed: sorted(issues.unweighed),
    },
  };
}
