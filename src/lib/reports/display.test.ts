import { describe, expect, it } from "vitest";
import { resolveColumnKey, translateCell } from "./display";

describe("resolveColumnKey", () => {
  it("separates columns that share a key but not a meaning", () => {
    expect(resolveColumnKey("destruction-records", "date")).toBe("destructionDate");
    expect(resolveColumnKey("movement-ledger", "date")).toBe("date");
    expect(resolveColumnKey("stage-transitions", "from")).toBe("fromStage");
    expect(resolveColumnKey("transfer-records", "from")).toBe("fromLocation");
    expect(resolveColumnKey("unit-detail", "stage")).toBe("stageState");
    expect(resolveColumnKey("by-stage", "stage")).toBe("stage");
  });

  it("returns null for an unknown column, so the generator label is shown", () => {
    expect(resolveColumnKey("movement-ledger", "brandNewColumn")).toBeNull();
    expect(resolveColumnKey(undefined, "unit")).toBe("unit");
  });
});

describe("translateCell", () => {
  it("translates vocabulary in columns that hold it", () => {
    expect(translateCell("unit-detail", "type", "PLANT")).toEqual({ ns: "unitType", key: "PLANT" });
    expect(translateCell("stage-transitions", "to", "FLOWERING")).toEqual({
      ns: "growthStage",
      key: "FLOWERING",
    });
    expect(translateCell("movement-ledger", "direction", "Addition")).toEqual({
      ns: "token",
      key: "addition",
    });
    expect(translateCell("transfer-records", "confirmed", "No")).toEqual({
      ns: "token",
      key: "no",
    });
    expect(translateCell("experiment-overview", "status", "completed")).toEqual({
      ns: "experimentStatus",
      key: "completed",
    });
    expect(translateCell("by-stage", "stage", "No stage")).toEqual({
      ns: "token",
      key: "noStage",
    });
  });

  it("translates the CTLS class and line a movement went on", () => {
    expect(translateCell("form-movements", "class", "Whole cannabis plants")).toEqual({
      ns: "ctlsClass",
      key: "wholePlants",
    });
    expect(
      translateCell("form-movements", "line", "Reductions - Shipped - domestic - to researchers")
    ).toEqual({ ns: "ctlsLine", key: "shippedResearchers" });
    expect(translateCell("form-movements", "line", "Reductions - Other")).toEqual({
      ns: "ctlsLine",
      key: "reductionsOther",
    });
    expect(translateCell("form-movements", "unit", "Whole cannabis plants")).toBeNull();
  });

  it("never touches names or free text, even when they look like vocabulary", () => {
    expect(translateCell("movement-ledger", "unit", "Moved")).toBeNull();
    expect(translateCell("transfer-records", "from", "Moved")).toBeNull();
    expect(translateCell("unit-detail", "cultivar", "Unknown")).toBeNull();
    expect(translateCell("unit-detail", "type", "Banana")).toBeNull();
    expect(translateCell("unit-detail", "type", 5)).toBeNull();
    expect(translateCell(undefined, "type", "PLANT")).toBeNull();
  });
});
