import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderRecordPdf, toPrintableText, wrapText, type PdfRecord } from "./record-pdf";

const record = (overrides: Partial<PdfRecord> = {}): PdfRecord => ({
  language: "en",
  brand: "Accession Book",
  title: "Unit record",
  subject: "EXP1-002-P01",
  meta: ["Generated today by Admin"],
  qr: { url: "https://example.test/inventory/units/1", caption: "Scan to open the live page" },
  footer: "Accession Book · Unit record · EXP1-002-P01",
  pageNumber: (page, total) => `Page ${page} of ${total}`,
  author: "Admin",
  generatedAt: new Date("2026-11-02T15:00:00Z"),
  sections: [],
  ...overrides,
});

const pagesOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe("toPrintableText", () => {
  const latin = new Set(Array.from({ length: 256 }, (_, code) => code));

  it("keeps what the font prints and line breaks", () => {
    expect(toPrintableText("Fiche de l’unité\nÉté", new Set([...latin, 0x2019]))).toBe(
      "Fiche de l’unité\nÉté"
    );
  });

  it("maps French number spacing and symbols the font lacks", () => {
    expect(toPrintableText("1 234,5 g ≥ 3 → ok", latin)).toBe("1 234,5 g >= 3 -> ok");
  });

  it("drops accents the font cannot print, and marks the rest", () => {
    expect(toPrintableText("Łódź ǅ α", latin)).toBe("?ódz Dz ?");
  });
});

describe("wrapText", () => {
  it("breaks at spaces, keeps no-break spaces, and splits a word only when it is wider than the line", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const width = font.widthOfTextAtSize("Room A · Flowering", 10);
    expect(wrapText("Room A · Flowering · Wet 1 234 g", font, 10, width)).toEqual([
      "Room A · Flowering",
      "· Wet 1 234 g",
    ]);
    const hash = "9f86d081884c7d659a2feaa0c55ad015";
    const lines = wrapText(hash, font, 10, width);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(hash);
    expect(lines.every((line) => font.widthOfTextAtSize(line, 10) <= width)).toBe(true);
    expect(wrapText("one\n\ntwo", font, 10, width)).toEqual(["one", "", "two"]);
  });
});

describe("renderRecordPdf", () => {
  it("writes a PDF with the record's metadata", async () => {
    const bytes = await renderRecordPdf(record());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe("Unit record - EXP1-002-P01");
    expect(doc.getAuthor()).toBe("Admin");
    expect(doc.getProducer()).toBe("Accession Book");
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it("carries a long table onto further pages", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => [
      String(index + 1),
      "Moved",
      "Room B · Flowering · a comment long enough to wrap onto a second line in its narrow column",
    ]);
    const bytes = await renderRecordPdf(
      record({
        sections: [
          {
            title: "Event history",
            blocks: [
              {
                kind: "table",
                columns: [
                  { header: "No.", width: 0.5, align: "end" },
                  { header: "Event", width: 1.5 },
                  { header: "Details", width: 3 },
                ],
                rows,
              },
            ],
          },
        ],
      })
    );
    expect(await pagesOf(bytes)).toBeGreaterThan(4);
  });

  it("lays out every kind of block, an over-long cell included", async () => {
    const bytes = await renderRecordPdf(
      record({
        qr: undefined,
        subtitle: "Plant · Northern Lights",
        sections: [
          {
            title: "Details",
            blocks: [
              {
                kind: "fields",
                fields: [
                  { label: "Unit ID", value: "12" },
                  { label: "Notes", value: "word ".repeat(400) },
                  { label: "Type", value: "Plant" },
                ],
              },
              {
                kind: "figures",
                figures: [
                  { label: "Wet weight now", value: "500 g", note: "Registered with 520 g" },
                  { label: "Dry weight now", value: "—" },
                ],
              },
              { kind: "text", text: "Weights are in grams.", muted: true },
              {
                kind: "table",
                columns: [{ header: "Comment", width: 1 }],
                rows: [["line ".repeat(3000)]],
                total: ["Total"],
              },
            ],
          },
        ],
      })
    );
    expect(await pagesOf(bytes)).toBeGreaterThanOrEqual(2);
  });
});
