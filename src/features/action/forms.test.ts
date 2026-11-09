import { describe, expect, it } from "vitest";
import {
  buildActivityPayload,
  buildDerivePayload,
  buildDestroyPayload,
  buildMeasurePayload,
  buildMovePayload,
  buildPlaceHoldPayload,
  buildRegisterPayload,
  buildReleaseHoldPayload,
  buildShipPayload,
  buildStagePayload,
  effectiveDate,
  initialDeriveValues,
  initialRegisterValues,
  initialShipValues,
  parseDecimal,
  parseId,
  previewNames,
  todayKey,
  validateAttachment,
  validateDestroyDetails,
  validateRegisterMaterial,
  type RegisterValues,
} from "./forms";

const TODAY = "2026-10-25";

const material = (overrides: Partial<RegisterValues> = {}): RegisterValues => ({
  ...initialRegisterValues(3),
  name: "E2E-PLT",
  cultivarId: "7",
  locationId: "2",
  sourceDescription: "Internal stock from the 2025 collection",
  ...overrides,
});

describe("parsing", () => {
  it("accepts a decimal comma and rejects junk", () => {
    expect(parseDecimal("12,5")).toBe(12.5);
    expect(parseDecimal(" 3 ")).toBe(3);
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });

  it("only accepts positive whole ids", () => {
    expect(parseId("12")).toBe(12);
    expect(parseId("0")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("")).toBeNull();
  });

  it("formats today in the browser zone as YYYY-MM-DD and omits it from requests", () => {
    expect(todayKey(new Date(2026, 9, 25, 23, 30))).toBe("2026-10-25");
    expect(effectiveDate(TODAY, TODAY)).toBeUndefined();
    expect(effectiveDate("2026-10-20", TODAY)).toBe("2026-10-20");
    expect(effectiveDate("", TODAY)).toBeUndefined();
  });
});

describe("register and receive", () => {
  it("builds the registration request body", () => {
    const built = buildRegisterPayload(
      material({ quantity: "3", growthStage: "FLOWERING" }),
      "register"
    );
    expect(built).toEqual({
      ok: true,
      payload: expect.objectContaining({
        type: "PLANT",
        name: "E2E-PLT",
        quantity: 3,
        experimentId: 3,
        cultivarId: 7,
        locationId: 2,
        growthStage: "FLOWERING",
        sourceType: "SEED",
        sourceDescription: "Internal stock from the 2025 collection",
      }),
    });
  });

  it("requires the material fields and flags each one", () => {
    const issues = validateRegisterMaterial(
      material({ experimentId: "", name: " ", cultivarId: "", locationId: "", quantity: "0" })
    );
    expect(Object.keys(issues).sort()).toEqual([
      "cultivarId",
      "experimentId",
      "locationId",
      "name",
      "quantity",
    ]);
    expect(issues.quantity).toEqual({ code: "range", min: 1, max: 50 });
  });

  it("rejects fractional and oversized quantities", () => {
    expect(validateRegisterMaterial(material({ quantity: "2.5" })).quantity?.code).toBe("invalid");
    expect(validateRegisterMaterial(material({ quantity: "51" })).quantity?.code).toBe("range");
  });

  it("requires a real source description when registering", () => {
    const short = buildRegisterPayload(material({ sourceDescription: "n/a" }), "register");
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.issues.sourceDescription).toEqual({ code: "tooShort", min: 10 });
  });

  it("requires a provider, not a description, when receiving, and sends RECEIVED", () => {
    const missing = buildRegisterPayload(material({ sourceDescription: "" }), "receive");
    expect(missing.ok).toBe(false);
    const ok = buildRegisterPayload(
      material({ sourceDescription: "", providerOrganizationId: "9" }),
      "receive"
    );
    expect(ok).toEqual({
      ok: true,
      payload: expect.objectContaining({ sourceType: "RECEIVED", providerOrganizationId: 9 }),
    });
  });

  it("sends weights only for plants and flowers, and a seed count only for seed lots", () => {
    const plant = buildRegisterPayload(
      material({ humidWeight: "12,5", seedCount: "40" }),
      "register"
    );
    expect(plant.ok && plant.payload.humidWeight).toBe(12.5);
    expect(plant.ok && plant.payload.seedCount).toBeUndefined();
    const lot = buildRegisterPayload(
      material({ type: "SEEDLOT", seedCount: "40", humidWeight: "9" }),
      "register"
    );
    expect(lot.ok && lot.payload.seedCount).toBe(40);
    expect(lot.ok && lot.payload.humidWeight).toBeUndefined();
    expect(lot.ok && lot.payload.growthStage).toBeUndefined();
  });

  it("previews the names a batch will get", () => {
    expect(previewNames("A", 1)).toEqual(["A"]);
    expect(previewNames("A", 3)).toEqual(["A-1", "A-3"]);
    expect(previewNames(" ", 3)).toEqual([]);
  });
});

describe("derive", () => {
  it("omits the stage for subcultures and empty optionals", () => {
    const values = { ...initialDeriveValues(["clone"], 4), growthStage: "FLOWERING" };
    expect(buildDerivePayload({ ...values, deriveType: "subculture" })).toEqual({
      ok: true,
      payload: expect.not.objectContaining({ growthStage: expect.anything() }),
    });
    const clone = buildDerivePayload(values);
    expect(clone.ok && clone.payload).toEqual({
      deriveType: "clone",
      quantity: 1,
      experimentId: 4,
      name: undefined,
      locationId: undefined,
      comment: undefined,
      growthStage: "FLOWERING",
    });
  });

  it("needs an experiment", () => {
    const built = buildDerivePayload(initialDeriveValues(["clone"], null));
    expect(built.ok).toBe(false);
  });
});

describe("move", () => {
  const unit = { name: "PLT-9", locationId: 2 };

  it("requires the barcode to equal the unit name", () => {
    const wrong = buildMovePayload({ toLocationId: "3", barcode: "PLT-8", comment: "" }, unit);
    expect(wrong.ok === false && wrong.issues.barcode).toEqual({ code: "mismatch" });
    const right = buildMovePayload({ toLocationId: "3", barcode: " PLT-9 ", comment: "" }, unit);
    expect(right).toEqual({
      ok: true,
      payload: { toLocationId: 3, barcode: "PLT-9", comment: undefined },
    });
  });

  it("refuses the location the unit is already in", () => {
    const built = buildMovePayload({ toLocationId: "2", barcode: "PLT-9", comment: "" }, unit);
    expect(built.ok === false && built.issues.toLocationId).toEqual({ code: "unchanged" });
  });
});

describe("stage", () => {
  it("rejects the current stage, a future date and an empty choice", () => {
    const same = buildStagePayload(
      { toStage: "FLOWERING", date: TODAY, comment: "" },
      { growthStage: "FLOWERING" },
      TODAY
    );
    expect(same.ok === false && same.issues.toStage?.code).toBe("unchanged");
    const future = buildStagePayload(
      { toStage: "CURING", date: "2026-11-01", comment: "" },
      { growthStage: null },
      TODAY
    );
    expect(future.ok === false && future.issues.date?.code).toBe("future");
    const empty = buildStagePayload(
      { toStage: "", date: TODAY, comment: "" },
      { growthStage: null },
      TODAY
    );
    expect(empty.ok).toBe(false);
  });

  it("sends a back-dated stage change with its date", () => {
    const built = buildStagePayload(
      { toStage: "HARVESTED", date: "2026-10-01", comment: " cut " },
      { growthStage: "FLOWERING" },
      TODAY
    );
    expect(built).toEqual({
      ok: true,
      payload: { toStage: "HARVESTED", effectiveAt: "2026-10-01", comment: "cut" },
    });
  });
});

describe("measure", () => {
  const empty = { humidWeight: "", dryWeight: "", seedCount: "", date: TODAY, comment: "" };

  it("needs at least one measurement", () => {
    const built = buildMeasurePayload(empty, "PLANT", TODAY);
    expect(built.ok === false && built.issues.any).toEqual({ code: "atLeastOne" });
  });

  it("rejects negative weights and ignores fields that do not apply to the type", () => {
    const negative = buildMeasurePayload({ ...empty, dryWeight: "-1" }, "FLOWER", TODAY);
    expect(negative.ok === false && negative.issues.dryWeight?.code).toBe("range");
    const lot = buildMeasurePayload(
      { ...empty, humidWeight: "5", seedCount: "120" },
      "SEEDLOT",
      TODAY
    );
    expect(lot).toEqual({
      ok: true,
      payload: {
        humidWeight: undefined,
        dryWeight: undefined,
        seedCount: 120,
        effectiveAt: undefined,
        comment: undefined,
      },
    });
  });

  it("allows zero", () => {
    expect(buildMeasurePayload({ ...empty, dryWeight: "0" }, "PLANT", TODAY).ok).toBe(true);
  });
});

describe("holds", () => {
  it("needs a reason of at least 10 characters", () => {
    expect(buildPlaceHoldPayload({ reason: "too short" }).ok).toBe(false);
    expect(buildPlaceHoldPayload({ reason: " Mould found on tray 4 " })).toEqual({
      ok: true,
      payload: { action: "hold", kind: "HOLD", reason: "Mould found on tray 4" },
    });
  });

  it("builds the release body", () => {
    expect(buildReleaseHoldPayload("  retest passed  ")).toEqual({
      action: "release",
      reason: "retest passed",
    });
  });
});

describe("destroy", () => {
  it("needs a date that is not in the future", () => {
    expect(Object.keys(validateDestroyDetails({ date: "2026-12-01" }, TODAY))).toEqual(["date"]);
    expect(validateDestroyDetails({ date: TODAY }, TODAY)).toEqual({});
  });

  it("builds the body the destroy route validates", () => {
    expect(buildDestroyPayload({ date: "2026-10-20" }, " contaminated ", TODAY)).toEqual({
      reason: "contaminated",
      effectiveAt: "2026-10-20",
    });
  });
});

describe("ship", () => {
  it("counts a plant and defaults the quantity to 1", () => {
    const unit = { id: 5, name: "PLT-5", type: "PLANT" };
    const values = {
      ...initialShipValues({ ...unit, seedCount: null, humidWeight: null, dryWeight: null }),
      organizationId: "8",
    };
    expect(buildShipPayload(values, unit)).toEqual({
      ok: true,
      payload: expect.objectContaining({
        direction: "OUTBOUND",
        status: "DRAFT",
        organizationId: 8,
        items: [{ unitId: 5, description: "PLT-5", materialType: "PLANT", unitCount: 1 }],
      }),
    });
  });

  it("weighs a flower with a wet or dry basis taken from the last measurement", () => {
    const unit = { id: 6, name: "FLW-6", type: "FLOWER" };
    const initial = initialShipValues({
      ...unit,
      seedCount: null,
      humidWeight: 30.5,
      dryWeight: 7.25,
    });
    expect(initial.moisture).toBe("DRY");
    expect(initial.quantity).toBe("7.25");
    const built = buildShipPayload({ ...initial, organizationId: "8", dispatchNow: true }, unit);
    expect(built.ok && built.payload.status).toBe("IN_TRANSIT");
    expect(built.ok && built.payload.items[0]).toEqual({
      unitId: 6,
      description: "FLW-6",
      materialType: "FLOWER",
      weightGrams: 7.25,
      moisture: "DRY",
    });
    const noBasis = buildShipPayload({ ...initial, organizationId: "8", moisture: "" }, unit);
    expect(noBasis.ok === false && noBasis.issues.moisture).toEqual({ code: "required" });
  });

  it("uses the seed count for a seed lot and needs a recipient", () => {
    const unit = { id: 7, name: "LOT-7", type: "SEEDLOT" };
    const initial = initialShipValues({
      ...unit,
      seedCount: 250,
      humidWeight: null,
      dryWeight: null,
    });
    expect(initial.quantity).toBe("250");
    const built = buildShipPayload(initial, unit);
    expect(built.ok === false && built.issues.organizationId).toEqual({ code: "required" });
  });
});

describe("activity and attachment", () => {
  it("requires a title", () => {
    expect(buildActivityPayload({ type: "NUTRIENT", title: " ", details: "" }).ok).toBe(false);
    expect(buildActivityPayload({ type: "NUTRIENT", title: "Fed 2 L", details: "" })).toEqual({
      ok: true,
      payload: {
        type: "NUTRIENT",
        title: "Fed 2 L",
        details: undefined,
        product: undefined,
        pcpNumber: undefined,
        amount: undefined,
        amountUnit: undefined,
        method: undefined,
      },
    });
  });

  it("asks a pesticide for its product, PCP registration number, amount and unit", () => {
    const pesticide = { type: "PESTICIDE", title: "Foliar spray", details: "" };
    const missing = buildActivityPayload(pesticide);
    expect(missing.ok === false && Object.keys(missing.issues).sort()).toEqual([
      "amount",
      "pcpNumber",
      "product",
    ]);
    expect(
      buildActivityPayload({ ...pesticide, product: "Neem", pcpNumber: "30500", amount: "2,5" })
    ).toMatchObject({ ok: false, issues: { amountUnit: { code: "required" } } });
    expect(
      buildActivityPayload({
        ...pesticide,
        product: " Neem oil ",
        pcpNumber: "30500",
        amount: "2.5",
        amountUnit: "L",
        method: "Foliar spray",
      })
    ).toMatchObject({
      ok: true,
      payload: { product: "Neem oil", pcpNumber: "30500", amount: 2.5, amountUnit: "L" },
    });
  });

  it("checks the file presence and size", () => {
    const values = { category: "PHOTO", label: "Tray 4" };
    expect(validateAttachment(values, null, 100).file?.code).toBe("required");
    expect(validateAttachment(values, { size: 0 }, 100).file?.code).toBe("required");
    expect(validateAttachment(values, { size: 101 }, 100).file?.code).toBe("range");
    expect(validateAttachment(values, { size: 50 }, 100)).toEqual({});
  });
});

describe("request bodies satisfy the server schemas", () => {
  // Importing the server schemas is slow when the whole suite runs in parallel.
  it("accepts every body the forms build", { timeout: 30_000 }, async () => {
    const unit = await import("@/features/unit/schemas");
    const shipment = await import("@/features/shipment/schemas");

    const register = buildRegisterPayload(
      material({ quantity: "2", humidWeight: "4,5" }),
      "register"
    );
    expect(register.ok && unit.registerUnitSchema.safeParse(register.payload).success).toBe(true);
    const receive = buildRegisterPayload(
      material({ sourceDescription: "", providerOrganizationId: "9" }),
      "receive"
    );
    expect(receive.ok && unit.registerUnitSchema.safeParse(receive.payload).success).toBe(true);

    const derive = buildDerivePayload({
      ...initialDeriveValues(["cutting"], 4),
      growthStage: "VEGETATIVE",
    });
    expect(derive.ok && unit.deriveUnitSchema.safeParse(derive.payload).success).toBe(true);

    const move = buildMovePayload(
      { toLocationId: "3", barcode: "P-1", comment: "" },
      { name: "P-1", locationId: 2 }
    );
    expect(move.ok && unit.moveUnitSchema.safeParse(move.payload).success).toBe(true);

    const stage = buildStagePayload(
      { toStage: "CURING", date: "2026-10-01", comment: "" },
      { growthStage: "DRYING" },
      TODAY
    );
    expect(stage.ok && unit.changeStageSchema.safeParse(stage.payload).success).toBe(true);

    const measure = buildMeasurePayload(
      { humidWeight: "", dryWeight: "3.2", seedCount: "", date: TODAY, comment: "" },
      "PLANT",
      TODAY
    );
    expect(measure.ok && unit.measureUnitSchema.safeParse(measure.payload).success).toBe(true);

    expect(
      unit.destroyUnitSchema.safeParse(
        buildDestroyPayload({ date: TODAY }, "contaminated batch", TODAY)
      ).success
    ).toBe(true);

    const activity = buildActivityPayload({
      type: "SCOUTING",
      title: "Checked trays",
      details: "",
    });
    expect(activity.ok && unit.recordActivitySchema.safeParse(activity.payload).success).toBe(true);

    for (const type of ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"]) {
      const target = { id: 5, name: "X-5", type };
      const values = {
        ...initialShipValues({ type, seedCount: 10, humidWeight: 2, dryWeight: null }),
        organizationId: "8",
        dispatchNow: true,
      };
      const ship = buildShipPayload(values, target);
      expect(ship.ok && shipment.createShipmentSchema.safeParse(ship.payload).success, type).toBe(
        true
      );
    }
  });
});
