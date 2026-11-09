import { describe, expect, it } from "vitest";
import {
  buildCtlsLedger,
  countryKind,
  eventMovements,
  holdingOf,
  shippedLine,
  type CounterpartyInfo,
  type LedgerState,
  type LedgerUnit,
} from "./ctls-ledger";
import { hasLine } from "./ctls-template";

const unit = (
  id: number,
  type: LedgerUnit["type"],
  extra: Partial<LedgerUnit> = {}
): LedgerUnit => ({
  id,
  name: `U${id}`,
  type,
  sourceType: "INTERNAL",
  hasParent: false,
  ...extra,
});

let nextState = 1;
const state = (unitId: number, extra: Partial<LedgerState> = {}): LedgerState => ({
  stateId: nextState++,
  unitId,
  kind: "MEASURED",
  growthStage: null,
  humidWeight: null,
  dryWeight: null,
  seedCount: null,
  counterparty: null,
  ...extra,
});

const lab = (extra: Partial<CounterpartyInfo> = {}): CounterpartyInfo => ({
  name: "Partner Lab",
  country: "Canada",
  licenceClass: "RESEARCH",
  ...extra,
});

describe("holdingOf", () => {
  const plant = unit(1, "PLANT");
  const flower = unit(2, "FLOWER");

  it("counts plants by stage: flowering plants are whole plants, the rest vegetative", () => {
    expect(holdingOf(plant, state(1, { growthStage: "VEGETATIVE" }))).toEqual({
      cls: "vegetativePlants",
      qty: 1,
    });
    expect(holdingOf(plant, state(1, { growthStage: "SEED" }))?.cls).toBe("vegetativePlants");
    expect(holdingOf(plant, state(1, { growthStage: "FLOWERING", humidWeight: 300 }))).toEqual({
      cls: "wholePlants",
      qty: 1,
    });
  });

  it("weighs harvested material: fresh at its wet weight until a dry weight exists", () => {
    expect(holdingOf(plant, state(1, { growthStage: "HARVESTED", humidWeight: 120.05 }))).toEqual({
      cls: "freshCannabis",
      qty: 1201,
    });
    expect(
      holdingOf(flower, state(2, { growthStage: "CURING", humidWeight: 100, dryWeight: 22.4 }))
    ).toEqual({ cls: "driedCannabis", qty: 224 });
    expect(holdingOf(plant, state(1, { humidWeight: 50 }))?.cls).toBe("freshCannabis");
  });

  it("holds nothing for cultures, unweighed harvests and units that have left", () => {
    expect(holdingOf(unit(3, "CULTURE"), state(3))).toBeNull();
    expect(holdingOf(plant, state(1, { growthStage: "DRYING" }))).toBeNull();
    expect(holdingOf(plant, state(1, { kind: "DESTROYED", growthStage: "VEGETATIVE" }))).toBeNull();
  });

  it("counts seeds in a seed lot", () => {
    expect(holdingOf(unit(4, "SEEDLOT"), state(4, { seedCount: 250 }))).toEqual({
      cls: "seeds",
      qty: 250,
    });
  });
});

describe("countryKind and shippedLine", () => {
  it("recognises Canada however it is written", () => {
    for (const name of ["Canada", " canada ", "CA", "Can.", "CANADÁ"]) {
      expect(countryKind(name), name).toBe("domestic");
    }
    expect(countryKind("France")).toBe("foreign");
    expect(countryKind(null)).toBe("unknown");
    expect(countryKind("  ")).toBe("unknown");
  });

  it("picks the line from the recipient's country, then its licence class", () => {
    expect(shippedLine(lab({ licenceClass: "ANALYTICAL_TESTING" }))).toBe("shippedTesters");
    expect(shippedLine(lab({ licenceClass: "RESEARCH" }))).toBe("shippedResearchers");
    expect(shippedLine(lab({ licenceClass: "CULTIVATION" }))).toBe("shippedCultivators");
    expect(shippedLine(lab({ licenceClass: "PROCESSING" }))).toBe("shippedCultivators");
    expect(shippedLine(lab({ country: "Netherlands", licenceClass: null }))).toBe("exported");
    expect(shippedLine(lab({ licenceClass: null }))).toBe("reductionsOther");
    expect(shippedLine(lab({ licenceClass: "MEDICAL_SALES" }))).toBe("reductionsOther");
    expect(shippedLine(null)).toBe("reductionsOther");
  });
});

describe("eventMovements", () => {
  const plant = unit(1, "PLANT");

  it("books a new unit as produced, received or other", () => {
    const created = state(1, { kind: "CREATED", growthStage: "VEGETATIVE" });
    expect(eventMovements(plant, created, undefined)).toEqual([
      { cls: "vegetativePlants", line: "additionsOther", qty: 1 },
    ]);
    expect(eventMovements(unit(1, "PLANT", { hasParent: true }), created, undefined)[0]?.line).toBe(
      "produced"
    );
    expect(
      eventMovements(unit(1, "PLANT", { sourceType: "SEED" }), created, undefined)[0]?.line
    ).toBe("produced");
    const received = (country: string | null) =>
      eventMovements(
        plant,
        state(1, { kind: "RECEIVED", growthStage: "VEGETATIVE", counterparty: lab({ country }) }),
        undefined
      )[0]?.line;
    expect(received("Canada")).toBe("receivedDomestic");
    expect(received("USA")).toBe("receivedImported");
    expect(received(null)).toBe("receivedDomestic");
  });

  it("moves a plant that starts flowering from vegetative to whole plants", () => {
    const flowering = state(1, { kind: "STAGE_CHANGED", growthStage: "FLOWERING" });
    expect(eventMovements(plant, flowering, { cls: "vegetativePlants", qty: 1 })).toEqual([
      { cls: "vegetativePlants", line: "processed", qty: 1 },
      { cls: "wholePlants", line: "produced", qty: 1 },
    ]);
  });

  it("harvests a plant into fresh cannabis, then dries it with the moisture as drying loss", () => {
    const harvested = state(1, {
      kind: "STAGE_CHANGED",
      growthStage: "HARVESTED",
      humidWeight: 400,
    });
    expect(eventMovements(plant, harvested, { cls: "wholePlants", qty: 1 })).toEqual([
      { cls: "wholePlants", line: "processed", qty: 1 },
      { cls: "freshCannabis", line: "produced", qty: 4000 },
    ]);
    const dried = state(1, { growthStage: "DRYING", humidWeight: 400, dryWeight: 90 });
    expect(eventMovements(plant, dried, { cls: "freshCannabis", qty: 4000 })).toEqual([
      { cls: "freshCannabis", line: "processed", qty: 900 },
      { cls: "freshCannabis", line: "dryingLoss", qty: 3100 },
      { cls: "driedCannabis", line: "produced", qty: 900 },
    ]);
  });

  it("books re-weighing as loss or other addition, and seed recounts as other", () => {
    const flower = unit(2, "FLOWER");
    expect(
      eventMovements(flower, state(2, { humidWeight: 90, dryWeight: 18 }), {
        cls: "driedCannabis",
        qty: 200,
      })
    ).toEqual([{ cls: "driedCannabis", line: "dryingLoss", qty: 20 }]);
    expect(
      eventMovements(flower, state(2, { humidWeight: 110 }), { cls: "freshCannabis", qty: 1000 })
    ).toEqual([{ cls: "freshCannabis", line: "additionsOther", qty: 100 }]);
    const lot = unit(4, "SEEDLOT");
    expect(eventMovements(lot, state(4, { seedCount: 450 }), { cls: "seeds", qty: 500 })).toEqual([
      { cls: "seeds", line: "reductionsOther", qty: 50 },
    ]);
  });

  it("ships what left on a partial shipment and everything on the last one", () => {
    const flower = unit(2, "FLOWER");
    const partial = state(2, {
      kind: "SHIPPED_PART",
      humidWeight: 70,
      counterparty: lab({ licenceClass: "ANALYTICAL_TESTING" }),
    });
    expect(eventMovements(flower, partial, { cls: "freshCannabis", qty: 1000 })).toEqual([
      { cls: "freshCannabis", line: "shippedTesters", qty: 300 },
    ]);
    const last = state(2, {
      kind: "SHIPPED",
      humidWeight: 0,
      counterparty: lab({ country: "USA" }),
    });
    expect(eventMovements(flower, last, { cls: "freshCannabis", qty: 700 })).toEqual([
      { cls: "freshCannabis", line: "exported", qty: 700 },
    ]);
  });

  it("destroys whatever the unit held", () => {
    expect(
      eventMovements(plant, state(1, { kind: "DESTROYED" }), { cls: "wholePlants", qty: 1 })
    ).toEqual([{ cls: "wholePlants", line: "destroyed", qty: 1 }]);
  });
});

describe("buildCtlsLedger", () => {
  it("reconciles every class over a month of mixed events, and books only the form's lines", () => {
    const units = new Map(
      [
        unit(1, "PLANT"),
        unit(2, "PLANT", { hasParent: true }),
        unit(3, "SEEDLOT"),
        unit(4, "FLOWER", { sourceType: "HARVEST" }),
        unit(5, "CULTURE"),
        unit(6, "PLANT"),
      ].map((u) => [u.id, u])
    );
    const opening = [
      state(1, { kind: "CREATED", growthStage: "VEGETATIVE" }),
      state(3, { kind: "CREATED", seedCount: 500 }),
      state(5, { kind: "CREATED" }),
      state(6, { kind: "DESTROYED", growthStage: "VEGETATIVE" }),
    ];
    const events = [
      state(1, { kind: "STAGE_CHANGED", growthStage: "FLOWERING" }),
      state(1, { kind: "STAGE_CHANGED", growthStage: "HARVESTED", humidWeight: 250 }),
      state(1, { growthStage: "DRYING", humidWeight: 250, dryWeight: 60 }),
      state(1, {
        kind: "SHIPPED_PART",
        growthStage: "DRYING",
        humidWeight: 250,
        dryWeight: 40,
        counterparty: lab(),
      }),
      state(2, { kind: "CREATED", growthStage: "VEGETATIVE" }),
      state(3, { seedCount: 480 }),
      state(3, { kind: "SHIPPED_PART", seedCount: 400, counterparty: lab({ licenceClass: null }) }),
      state(4, { kind: "CREATED", growthStage: "HARVESTED", humidWeight: 80 }),
      state(4, { kind: "DESTROYED", growthStage: "HARVESTED", humidWeight: 80 }),
      state(5, { kind: "SHIPPED", counterparty: lab() }),
      // After the destruction: ignored.
      state(6, { growthStage: "FLOWERING" }),
    ];
    const closing = [
      state(1, { growthStage: "DRYING", humidWeight: 250, dryWeight: 40 }),
      state(2, { growthStage: "VEGETATIVE" }),
      state(3, { seedCount: 400 }),
      state(4, { kind: "DESTROYED", humidWeight: 80 }),
      state(5, { kind: "SHIPPED" }),
      state(6, { kind: "DESTROYED" }),
    ];

    const ledger = buildCtlsLedger({ units, opening, events, closing });
    expect(ledger.reconciles).toBe(true);
    expect(ledger.classes.vegetativePlants).toMatchObject({
      opening: 1,
      closing: 1,
      lines: { processed: 1, produced: 1 },
    });
    expect(ledger.classes.wholePlants).toMatchObject({
      opening: 0,
      closing: 0,
      lines: { produced: 1, processed: 1 },
    });
    expect(ledger.classes.freshCannabis).toMatchObject({
      opening: 0,
      closing: 0,
      lines: { produced: 3300, processed: 600, dryingLoss: 1900, destroyed: 800 },
    });
    expect(ledger.classes.driedCannabis).toMatchObject({
      closing: 400,
      lines: { produced: 600, shippedResearchers: 200 },
    });
    expect(ledger.classes.seeds).toMatchObject({
      opening: 500,
      closing: 400,
      lines: { reductionsOther: 100 },
    });
    expect(ledger.cultures).toEqual({ opening: 1, added: 0, removed: 1, closing: 0 });
    expect(ledger.issues.recipientUnclassified).toEqual(["Partner Lab"]);
    for (const movement of ledger.movements) {
      expect(hasLine(movement.cls, movement.line), `${movement.cls} ${movement.line}`).toBe(true);
    }
  });

  it("flags a month whose closing does not follow from its events", () => {
    const units = new Map([[1, unit(1, "PLANT")]]);
    const ledger = buildCtlsLedger({
      units,
      opening: [],
      events: [],
      closing: [state(1, { kind: "CREATED", growthStage: "VEGETATIVE" })],
    });
    expect(ledger.classes.vegetativePlants.reconciles).toBe(false);
    expect(ledger.reconciles).toBe(false);
  });

  it("books nothing when part of a unit becomes a sample: the class still reconciles", () => {
    const units = new Map([
      [1, unit(1, "FLOWER")],
      [2, unit(2, "FLOWER", { hasParent: true, isSample: true })],
    ]);
    const opening = [state(1, { kind: "CREATED", humidWeight: 500, dryWeight: 100 })];
    const sampled = state(1, { kind: "SAMPLED", humidWeight: 500, dryWeight: 98 });
    const created = state(2, { kind: "CREATED", dryWeight: 2 });
    const ledger = buildCtlsLedger({
      units,
      opening,
      events: [sampled, created],
      closing: [sampled, created],
    });
    expect(ledger.reconciles).toBe(true);
    expect(ledger.classes.driedCannabis).toMatchObject({ opening: 1000, closing: 1000, lines: {} });
  });

  it("books waste disposed of from a unit as destroyed", () => {
    const units = new Map([[1, unit(1, "FLOWER")]]);
    const opening = [state(1, { kind: "CREATED", humidWeight: 500 })];
    const wasted = state(1, { kind: "WASTED", humidWeight: 470 });
    const ledger = buildCtlsLedger({ units, opening, events: [wasted], closing: [wasted] });
    expect(ledger.reconciles).toBe(true);
    expect(ledger.classes.freshCannabis).toMatchObject({
      opening: 5000,
      closing: 4700,
      lines: { destroyed: 300 },
    });
  });

  it("counts a plant group's plants, and books nothing when plants move between groups", () => {
    const units = new Map([
      [1, unit(1, "PLANT")],
      [2, unit(2, "PLANT", { hasParent: true, sourceType: "SPLIT" })],
      [3, unit(3, "PLANT")],
    ]);
    const opening = [
      state(1, { kind: "CREATED", growthStage: "VEGETATIVE", plantCount: 50 }),
      state(3, { kind: "CREATED", growthStage: "VEGETATIVE", plantCount: 10 }),
    ];
    const split = state(1, { kind: "REGROUPED", growthStage: "VEGETATIVE", plantCount: 30 });
    const child = state(2, { kind: "CREATED", growthStage: "VEGETATIVE", plantCount: 20 });
    const joined = state(3, { kind: "REGROUPED", growthStage: "VEGETATIVE", plantCount: 30 });
    const merged = state(2, { kind: "MERGED", growthStage: "VEGETATIVE", plantCount: 20 });
    const ledger = buildCtlsLedger({
      units,
      opening,
      events: [split, child, merged, joined],
      closing: [split, merged, joined],
    });
    expect(ledger.reconciles).toBe(true);
    expect(ledger.classes.vegetativePlants).toMatchObject({ opening: 60, closing: 60, lines: {} });
  });

  it("destroys every plant of a group", () => {
    const units = new Map([[1, unit(1, "PLANT")]]);
    const opening = [state(1, { kind: "CREATED", growthStage: "FLOWERING", plantCount: 12 })];
    const destroyed = state(1, { kind: "DESTROYED", growthStage: "FLOWERING", plantCount: 12 });
    const ledger = buildCtlsLedger({ units, opening, events: [destroyed], closing: [destroyed] });
    expect(ledger.classes.wholePlants).toMatchObject({
      opening: 12,
      closing: 0,
      lines: { destroyed: 12 },
    });
    expect(ledger.reconciles).toBe(true);
  });

  it("lists harvested units that have no weight at the month's end", () => {
    const units = new Map([[1, unit(1, "PLANT")]]);
    const ledger = buildCtlsLedger({
      units,
      opening: [state(1, { kind: "CREATED", growthStage: "FLOWERING" })],
      events: [state(1, { kind: "STAGE_CHANGED", growthStage: "HARVESTED" })],
      closing: [state(1, { growthStage: "HARVESTED" })],
    });
    expect(ledger.issues.unweighed).toEqual(["U1"]);
    expect(ledger.classes.wholePlants.lines.processed).toBe(1);
    expect(ledger.reconciles).toBe(true);
  });
});
