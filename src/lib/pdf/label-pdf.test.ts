import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { barcodeBars, renderLabelPdf, type LabelContent } from "./label-pdf";

const LABEL: LabelContent = {
  title: "AB1-P-0001",
  lines: ["Plant · Northern Lights", "Experiment AB1"],
  qr: "https://lab.example/inventory/units/1",
  barcode: "AB1-P-0001",
};

const render = (template: Parameters<typeof renderLabelPdf>[0]["template"], count: number) =>
  renderLabelPdf({
    template,
    labels: Array.from({ length: count }, () => LABEL),
    title: "Labels",
    author: "Admin",
    brand: "Accession Book",
    language: "en",
    generatedAt: new Date("2026-11-03T12:00:00Z"),
  }).then((bytes) => PDFDocument.load(bytes));

describe("label PDF", () => {
  it("puts 30 labels on each Avery 5160 sheet", async () => {
    const doc = await render("avery-5160", 31);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it("prints one label per page on a roll, at the label's size", async () => {
    const doc = await render("zebra-2x1", 3);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(2).getSize()).toEqual({ width: 144, height: 72 });
  });

  it("draws the smallest labels too, and an empty sheet when there is nothing to print", async () => {
    expect((await render("avery-5167", 81)).getPageCount()).toBe(2);
    expect((await render("avery-5163", 0)).getPageCount()).toBe(1);
  });

  it("leaves out a barcode that Code 128 cannot encode", () => {
    expect(barcodeBars("AB1-P-0001")).toMatch(/^[01]+$/);
    expect(barcodeBars("Plante é")).toBeNull();
  });
});
