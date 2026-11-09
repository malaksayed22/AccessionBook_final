import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CTLS_CLASSES, ctlsFormHeaders, ctlsFormRow, hasLine } from "./ctls-template";

/** Columns A to JS of Health Canada's reporting form, copied word for word, one per line. */
const OFFICIAL_HEADERS = readFileSync(
  path.join(import.meta.dirname, "ctls-form-headers.fixture.txt"),
  "utf8"
)
  .split(/\r?\n/)
  .filter((line) => line.length > 0);

describe("ctlsFormHeaders", () => {
  it("matches Health Canada's reporting form, columns A to JS, word for word", () => {
    expect(OFFICIAL_HEADERS).toHaveLength(279);
    expect(ctlsFormHeaders()).toEqual(OFFICIAL_HEADERS);
  });

  it("keeps the form's line set per class", () => {
    expect(hasLine("seeds", "dryingLoss")).toBe(false);
    expect(hasLine("vegetativePlants", "dryingLoss")).toBe(true);
    expect(hasLine("purchasedHemp", "produced")).toBe(false);
    expect(hasLine("ediblesSolids", "processed")).toBe(false);
    expect(hasLine("pureIntermediates", "processed")).toBe(false);
    expect(hasLine("pureIntermediates", "processedTopicals")).toBe(true);
  });
});

describe("ctlsFormRow", () => {
  const row = ctlsFormRow(
    { year: 2026, month: 3, licenceId: "LIC-123" },
    { seeds: { opening: 500, closing: 450 }, driedCannabis: { closing: 0.0185 } }
  );
  const headers = ctlsFormHeaders();
  const cell = (header: string) => row[headers.indexOf(header)];

  it("gives one cell per header, with the period and licence first", () => {
    expect(row).toHaveLength(headers.length);
    expect(row.slice(0, 3)).toEqual(["2026", "03", "LIC-123"]);
  });

  it("writes quantities, zeros for the rest and blanks for values", () => {
    expect(cell("Unpackaged - Seeds - Opening inventory (#)")).toBe(500);
    expect(cell("Unpackaged - Seeds - Closing inventory (#)")).toBe(450);
    expect(cell("Unpackaged - Dried cannabis - Closing inventory (kg)")).toBe(0.0185);
    expect(cell("Unpackaged - Topicals - Opening inventory (kg)")).toBe(0);
    expect(cell("Unpackaged - Seeds - Closing inventory value ($)")).toBe("");
    expect(cell("Unpackaged - Seeds - Reductions - Shipped - exported value ($)")).toBe("");
  });

  it("leaves the licence blank when none is known", () => {
    expect(ctlsFormRow({ year: 2026, month: 11, licenceId: null }, {})[2]).toBe("");
  });

  it("covers all fourteen classes", () => {
    expect(CTLS_CLASSES).toHaveLength(14);
  });
});
