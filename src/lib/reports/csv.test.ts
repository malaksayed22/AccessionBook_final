import { describe, expect, it } from "vitest";
import { ctlsChecks, ctlsFormCsv, escapeCsvCell, reportToCsv } from "./csv";
import type { CtlsSection, ReportResult } from "./types";

describe("escapeCsvCell", () => {
  it("passes plain values through and blanks null/undefined", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and line breaks per RFC 4180", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd", '=HYPERLINK("http://x","y")'])(
    "neutralises the formula %j with a leading single quote",
    (input) => {
      const out = escapeCsvCell(input);
      const unquoted = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
      expect(unquoted).toBe(`'${input}`);
    }
  );

  it("quotes after neutralising when the text also needs RFC quoting", () => {
    expect(escapeCsvCell("=A1,B1")).toBe(`"'=A1,B1"`);
  });

  it("leaves numbers and negative numeric text alone", () => {
    expect(escapeCsvCell(-5)).toBe("-5");
    expect(escapeCsvCell(-0.25)).toBe("-0.25");
    expect(escapeCsvCell("-12.5")).toBe("-12.5");
  });

  it("does not touch text that merely contains a formula character", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
    expect(escapeCsvCell("Room 1 - North")).toBe("Room 1 - North");
    expect(escapeCsvCell("—")).toBe("—");
  });
});

function ctlsFixture(overrides: Partial<CtlsSection> = {}): CtlsSection {
  return {
    year: 2025,
    month: 1,
    classes: [
      {
        id: "seeds",
        measure: "#",
        lines: { opening: 500, additionsOther: 0, reductionsOther: 50, closing: 450 },
        reconciles: true,
      },
      {
        id: "driedCannabis",
        measure: "kg",
        lines: { opening: 0.01, produced: 0.0185, dryingLoss: 0.0005, closing: 0.028 },
        reconciles: true,
      },
    ],
    reconciles: true,
    cultures: { opening: 1, added: 0, removed: 1, closing: 0 },
    issues: {
      licenceIdMissing: false,
      countryMissing: [],
      recipientUnclassified: ["Lab B"],
      unweighed: [],
      trimShipped: { lines: 0, grams: 0 },
    },
    reconciliationNotes: ["A note"],
    ...overrides,
  };
}

describe("reportToCsv", () => {
  const result: ReportResult = {
    meta: {
      reportId: "x",
      title: "Report",
      generatedAt: "2025-01-01T00:00:00.000Z",
      periodLabel: "January 2025",
      licenseId: "=EVIL()",
    },
    ctls: ctlsFixture(),
    sections: [
      {
        title: "Rows",
        columns: [
          { key: "unit", label: "Unit" },
          { key: "note", label: "Note" },
        ],
        rows: [
          { unit: "P1", note: "=cmd|' /C calc'!A0" },
          { unit: "P2", note: 'has "quotes", and commas' },
          { unit: "P3", note: null },
        ],
      },
    ],
  };

  it("neutralises formulas in every cell, including header metadata", () => {
    const lines = reportToCsv(result).split("\n");
    expect(lines).toContain("Licence ID,'=EVIL()");
    expect(lines).toContain("P1,'=cmd|' /C calc'!A0");
  });

  it("keeps RFC quoting and blank cells in data rows", () => {
    const lines = reportToCsv(result).split("\n");
    expect(lines).toContain('P2,"has ""quotes"", and commas"');
    expect(lines).toContain("P3,");
  });

  it("writes the CTLS lines down and the classes across, with the checks and notes", () => {
    const lines = reportToCsv(result).split("\n");
    expect(lines).toContain("Line,Seeds (#),Dried cannabis (kg)");
    expect(lines).toContain("Opening inventory,500,0.01");
    expect(lines).toContain("Reductions - Adjustment for drying / processing loss,,0.0005");
    expect(lines).toContain("Closing inventory,450,0.028");
    expect(lines).toContain("Reconciles,Yes,Yes");
    expect(lines).toContain("Cultures,1,0,1,0");
    expect(lines).toContain("Check before filing");
    expect(lines).toContain("A note");
  });
});

describe("ctlsChecks", () => {
  it("names what needs looking at, and nothing when all is in order", () => {
    expect(ctlsChecks(ctlsFixture())).toEqual([
      'Shipped under "Other" because the recipient has no licence class: Lab B',
    ]);
    const clean = ctlsFixture({
      issues: {
        licenceIdMissing: false,
        countryMissing: [],
        recipientUnclassified: [],
        unweighed: [],
        trimShipped: { lines: 0, grams: 0 },
      },
    });
    expect(ctlsChecks(clean)).toEqual([]);
  });
});

describe("ctlsFormCsv", () => {
  it("writes the form's header row and one data row, CRLF-terminated", () => {
    const csv = ctlsFormCsv(ctlsFixture(), "LIC-1");
    const [header, data, end] = csv.split("\r\n");
    expect(end).toBe("");
    const headers = header!.split(",");
    const cells = data!.split(",");
    expect(headers).toHaveLength(279);
    expect(cells).toHaveLength(279);
    expect(cells.slice(0, 3)).toEqual(["2025", "01", "LIC-1"]);
    const cell = (name: string) => cells[headers.indexOf(name)];
    expect(cell("Unpackaged - Seeds - Closing inventory (#)")).toBe("450");
    expect(cell("Unpackaged - Dried cannabis - Additions - Produced (kg)")).toBe("0.0185");
    expect(cell("Unpackaged - Fresh cannabis - Opening inventory (kg)")).toBe("0");
    expect(cell("Unpackaged - Seeds - Closing inventory value ($)")).toBe("");
  });

  it("neutralises a licence number that looks like a formula", () => {
    const [, data] = ctlsFormCsv(ctlsFixture(), "=EVIL()").split("\r\n");
    expect(data!.split(",")[2]).toBe("'=EVIL()");
  });
});
