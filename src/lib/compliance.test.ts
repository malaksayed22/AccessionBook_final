import { describe, expect, it } from "vitest";
import {
  buildFinding,
  daysBetween,
  FINDING_IDS,
  FINDING_SEVERITY,
  OFFENDER_LIMIT,
  openFindingsByUrgency,
  summarizeFindings,
  type FindingId,
  type Offender,
} from "./compliance";

const offender = (id: number): Offender => ({
  id,
  label: `U${id}`,
  detail: { key: "noCultivar", params: {} },
  href: `/inventory/units/${id}`,
});

describe("buildFinding", () => {
  it("passes exactly when nothing is wrong, and takes severity from the catalog", () => {
    expect(buildFinding("inventory-located", 0, [])).toMatchObject({
      passing: true,
      severity: "critical",
    });
    expect(buildFinding("experiment-attribution", 3, [])).toMatchObject({
      passing: false,
      severity: "info",
    });
  });

  it("caps the listed records but keeps the full count", () => {
    const many = Array.from({ length: OFFENDER_LIMIT + 8 }, (_, i) => offender(i));
    const finding = buildFinding("cultivar-attribution", many.length, many);
    expect(finding.count).toBe(OFFENDER_LIMIT + 8);
    expect(finding.offenders).toHaveLength(OFFENDER_LIMIT);
  });
});

describe("summarizeFindings", () => {
  const checkedAt = new Date("2026-03-01T00:00:00Z");
  const clean = FINDING_IDS.map((id) => buildFinding(id, 0, []));

  it("counts a clean laboratory as fully passing", () => {
    expect(summarizeFindings(clean, checkedAt)).toMatchObject({
      totalChecks: FINDING_IDS.length,
      passingCount: FINDING_IDS.length,
      criticalCount: 0,
      warningCount: 0,
      advisoryCount: 0,
    });
  });

  it("counts open findings by severity", () => {
    const open: FindingId[] = [
      "inventory-located",
      "harvest-weights",
      "quality-holds",
      "experiment-attribution",
    ];
    const findings = clean.map((finding) =>
      open.includes(finding.id) ? buildFinding(finding.id, 2, []) : finding
    );
    expect(summarizeFindings(findings, checkedAt)).toMatchObject({
      passingCount: FINDING_IDS.length - 4,
      criticalCount: 2,
      warningCount: 1,
      advisoryCount: 1,
    });
  });
});

describe("openFindingsByUrgency", () => {
  it("lists critical before warning before advisory, and bigger problems first", () => {
    const report = summarizeFindings(
      [
        buildFinding("experiment-attribution", 50, []),
        buildFinding("quality-holds", 9, []),
        buildFinding("inventory-located", 1, []),
        buildFinding("harvest-weights", 4, []),
        buildFinding("open-incidents", 0, []),
      ],
      new Date()
    );
    expect(openFindingsByUrgency(report).map((f) => f.id)).toEqual([
      "harvest-weights",
      "inventory-located",
      "quality-holds",
      "experiment-attribution",
    ]);
  });
});

describe("catalog", () => {
  it("gives every check a severity", () => {
    for (const id of FINDING_IDS) expect(FINDING_SEVERITY[id]).toBeDefined();
  });
});

describe("daysBetween", () => {
  it("counts whole days, negative when reversed", () => {
    const a = new Date("2026-03-01T12:00:00Z");
    expect(daysBetween(a, new Date("2026-03-04T11:59:00Z"))).toBe(2);
    expect(daysBetween(a, new Date("2026-03-04T12:00:00Z"))).toBe(3);
    expect(daysBetween(new Date("2026-03-04T12:00:00Z"), a)).toBe(-3);
  });
});
