import { describe, expect, it } from "vitest";
import {
  emptyLine,
  lineProblem,
  lineProblems,
  linePayload,
  partMaterials,
  type LineDraft,
} from "./shipment-draft";

const line = (patch: Partial<LineDraft>): LineDraft => ({
  ...emptyLine(1),
  description: "Seeds",
  ...patch,
});

describe("lineProblem", () => {
  it("needs a description", () => {
    expect(lineProblem(line({ description: "   ", unitCount: "5" }))).toBe("description");
  });

  it("books counted material by whole units", () => {
    expect(lineProblem(line({ materialType: "SEED", unitCount: "" }))).toBe("countMissing");
    expect(lineProblem(line({ materialType: "CLONE", unitCount: "2.5" }))).toBe("countNotWhole");
    expect(lineProblem(line({ materialType: "PLANT", unitCount: "-1" }))).toBe("negative");
    expect(lineProblem(line({ materialType: "SEED", unitCount: "12" }))).toBeNull();
    expect(lineProblem(line({ materialType: "CULTURE", unitCount: "0" }))).toBeNull();
  });

  it("books weighed material in grams with a wet or dry basis", () => {
    expect(lineProblem(line({ materialType: "FLOWER", weightGrams: "" }))).toBe("weightMissing");
    expect(lineProblem(line({ materialType: "FLOWER", weightGrams: "12.5" }))).toBe("basisMissing");
    expect(lineProblem(line({ materialType: "TRIM", weightGrams: "-3", moisture: "DRY" }))).toBe(
      "negative"
    );
    expect(
      lineProblem(line({ materialType: "FLOWER", weightGrams: "12.5", moisture: "WET" }))
    ).toBeNull();
  });

  it("ignores the count of a weighed line and the weight of a counted one", () => {
    expect(
      lineProblem(
        line({ materialType: "FLOWER", unitCount: "x", weightGrams: "1", moisture: "DRY" })
      )
    ).toBeNull();
    expect(
      lineProblem(line({ materialType: "SEED", unitCount: "3", weightGrams: "oops" }))
    ).toBeNull();
  });
});

describe("lineProblems", () => {
  it("lists the lines that cannot be sent, by key", () => {
    const lines = [
      line({ key: 1, unitCount: "4" }),
      line({ key: 2, unitCount: "" }),
      line({ key: 3, description: "" }),
    ];
    expect(lineProblems(lines)).toEqual({ 2: "countMissing", 3: "description" });
    expect(lineProblems([lines[0]!])).toEqual({});
  });
});

describe("linePayload", () => {
  it("sends a count only for counted material and a weight only for weighed material", () => {
    expect(
      linePayload(line({ materialType: "SEED", unitCount: "7", weightGrams: "9" }))
    ).toMatchObject({
      unitCount: 7,
      weightGrams: null,
      moisture: null,
    });
    expect(
      linePayload(
        line({ materialType: "FLOWER", unitCount: "7", weightGrams: "9.25", moisture: "DRY" })
      )
    ).toMatchObject({ unitCount: null, weightGrams: 9.25, moisture: "DRY" });
  });

  it("turns blank links into nulls and ids into numbers", () => {
    expect(linePayload(line({ unitCount: "1", cultivarId: "", unitId: "" }))).toMatchObject({
      cultivarId: null,
      unitId: null,
      comment: null,
    });
    expect(
      linePayload(line({ unitCount: "1", cultivarId: "4", unitId: "12", comment: " ok " }))
    ).toMatchObject({
      cultivarId: 4,
      unitId: 12,
      comment: "ok",
    });
  });
});

describe("outbound lines", () => {
  it("must come from inventory, except trim", () => {
    expect(lineProblem(line({}), true)).toBe("needsUnit");
    expect(lineProblem(line({ unitId: "7", unitName: "U7", unitCount: "1" }), true)).toBeNull();
    expect(
      lineProblem(
        line({ materialType: "TRIM", weightGrams: "3", moisture: "WET", description: "Trim" }),
        true
      )
    ).toBeNull();
    // Received lines never name a unit.
    expect(lineProblem(line({ unitCount: "10" }), false)).toBeNull();
  });

  describe("shipping part of a unit", () => {
    it("needs the material of a part", () => {
      expect(lineProblem(line({ shipMode: "part", materialType: "", unitId: "4" }), true)).toBe(
        "materialMissing"
      );
    });

    it("offers the parts each kind of unit can give, counted or weighed", () => {
      expect(partMaterials("PLANT", false)).toEqual(["CLONE", "CULTURE", "SEED"]);
      expect(partMaterials("PLANT", true)).toContain("FLOWER");
      expect(partMaterials("FLOWER", true)).toEqual(["FLOWER", "TRIM", "SEED"]);
      expect(partMaterials("SEEDLOT", false)).toEqual(["SEED"]);
      // A culture ships whole.
      expect(partMaterials("CULTURE", false)).toEqual([]);
    });
  });
});
