import { describe, expect, it } from "vitest";
import { detectFileType, safeDisplayName } from "./file-types";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("detectFileType", () => {
  it("recognises the allowed binary formats by their signature", () => {
    expect(detectFileType(ascii("%PDF-1.7 ..."), "x.pdf")?.ext).toBe("pdf");
    expect(
      detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "x.png")?.ext
    ).toBe("png");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0), "x.jpg")?.mime).toBe("image/jpeg");
    expect(detectFileType(ascii("RIFF\0\0\0\0WEBPVP8 "), "x.webp")?.ext).toBe("webp");
  });

  it("ignores the claimed name: an HTML or SVG file renamed .png is still refused", () => {
    expect(detectFileType(ascii("<html><script>alert(1)</script></html>"), "photo.png")).toBeNull();
    expect(
      detectFileType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "logo.svg")
    ).toBeNull();
    expect(
      detectFileType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "logo.png")
    ).toBeNull();
  });

  it("detects a real PDF even when it is named something else", () => {
    expect(detectFileType(ascii("%PDF-1.4"), "report.exe")?.ext).toBe("pdf");
  });

  it("refuses archives, executables and empty files", () => {
    expect(detectFileType(bytes(0x50, 0x4b, 0x03, 0x04), "data.zip")).toBeNull();
    expect(detectFileType(bytes(0x4d, 0x5a, 0x90, 0x00), "setup.exe")).toBeNull();
    expect(detectFileType(new Uint8Array(0), "empty.pdf")).toBeNull();
  });

  it("accepts text only for csv/txt names and only when it is really text", () => {
    expect(detectFileType(ascii("a,b\n1,2\n"), "results.csv")?.mime).toMatch(/^text\/csv/);
    expect(detectFileType(ascii("notes"), "notes.txt")?.ext).toBe("txt");
    expect(detectFileType(ascii("a,b\n"), "results.html")).toBeNull();
    expect(detectFileType(ascii("a,b\0\n"), "results.csv")).toBeNull(); // NUL byte: binary
    expect(detectFileType(bytes(0xff, 0xfe, 0xfd), "results.csv")).toBeNull(); // not UTF-8
  });

  it("accepts accented UTF-8 text", () => {
    expect(detectFileType(ascii("échantillon,résultat\n"), "labo.csv")?.ext).toBe("csv");
  });
});

describe("safeDisplayName", () => {
  it("drops path parts and markup characters", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(safeDisplayName('a<script>"b.pdf')).toBe("a_script__b.pdf");
  });

  it("never returns an empty name and caps the length", () => {
    expect(safeDisplayName("")).toBe("file");
    expect(safeDisplayName("x".repeat(500)).length).toBe(150);
  });
});

/** A minimal stored (uncompressed) ZIP with the given entry names, like an Office file's layout. */
function zipOf(names: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const name of names) {
    const raw = [...encoder.encode(name)];
    const offset = locals.length;
    locals.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u32(0), ...u32(0));
    locals.push(...u32(0), ...u32(0), ...u16(raw.length), ...u16(0), ...raw);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u32(0));
    central.push(...u32(0), ...u32(0), ...u32(0), ...u16(raw.length), ...u16(0), ...u16(0));
    central.push(...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...raw);
  }
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(names.length),
    ...u16(names.length),
    ...u32(central.length),
    ...u32(locals.length),
    ...u16(0),
  ];
  return new Uint8Array([...locals, ...central, ...end]);
}

describe("Office documents", () => {
  it("accepts a Word document and an Excel workbook by their layout, not their name", () => {
    const docx = zipOf(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    const xlsx = zipOf(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(detectFileType(docx, "protocol.pdf")?.ext).toBe("docx");
    expect(detectFileType(xlsx, "coa.bin")?.ext).toBe("xlsx");
  });

  it("refuses macros, ActiveX, embedded binaries and plain archives", () => {
    const macro = zipOf(["[Content_Types].xml", "xl/workbook.xml", "xl/vbaProject.bin"]);
    const activeX = zipOf(["[Content_Types].xml", "word/document.xml", "word/activeX/x.xml"]);
    const embedded = zipOf(["[Content_Types].xml", "word/document.xml", "word/embeddings/a.exe"]);
    const traversal = zipOf(["[Content_Types].xml", "word/document.xml", "../evil.xml"]);
    const plain = zipOf(["readme.txt", "script.js"]);
    for (const file of [macro, activeX, embedded, traversal, plain]) {
      expect(detectFileType(file, "file.docx")).toBeNull();
    }
  });

  it("refuses a broken archive", () => {
    expect(detectFileType(ascii("PK\u0003\u0004 not really a zip"), "x.xlsx")).toBeNull();
  });
});
