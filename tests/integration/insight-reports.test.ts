import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadReport, loadReportCsv, loadReportFilterOptions } from "@/features/report/queries";
import { changeStage, destroyUnit, moveUnit } from "@/features/unit/service";
import { REPORTS } from "@/lib/report-catalog";
import {
  isKpiId,
  isSectionId,
  isSectionWithDescription,
  resolveColumnKey,
} from "@/lib/reports/display";
import { runReport } from "@/lib/reports";
import { GrowthStage } from "@/generated/prisma/enums";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase } from "./helpers";

process.env.LAB_TIMEZONE = "America/Toronto";

type Lab = Awaited<ReturnType<typeof createLab>>;

const messages = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../messages/en/reports.json"), "utf8")
) as {
  catalog: Record<string, { title: string; description: string }>;
  display: {
    sections: Record<string, string>;
    sectionDescriptions: Record<string, string>;
    columns: Record<string, string>;
    kpis: Record<string, string>;
    ctls: { classes: Record<string, string>; lines: Record<string, string> };
  };
};

async function code(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

describe("insight reports", () => {
  let lab: Lab;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    const a = await registerOne(lab, { name: "Rep-A" });
    const b = await registerOne(lab, { name: "Rep-B", locationId: lab.rooms[1].id });
    await moveUnit(lab.member, a.id, { toLocationId: lab.rooms[2].id }, { requireScan: false });
    await changeStage(lab.member, a.id, { toStage: GrowthStage.FLOWERING } as Parameters<
      typeof changeStage
    >[2]);
    await destroyUnit(lab.admin, b.id, {
      reason: "Mildew, destroyed per SOP",
    });
  });

  it("is for administrators only", async () => {
    expect(await code(loadReport(lab.member, "ctls-monthly", {}))).toBe("FORBIDDEN");
    expect(await code(loadReportCsv(lab.member, "ctls-monthly", {}))).toBe("FORBIDDEN");
    expect(await code(loadReportFilterOptions(lab.member))).toBe("FORBIDDEN");
  });

  it("refuses a report that does not exist", async () => {
    expect(await code(loadReport(lab.admin, "no-such-report", {}))).toBe("NOT_FOUND");
  });

  it("offers the catalog's reports, and every one of them runs", async () => {
    expect(REPORTS.map((r) => r.id)).toContain("state-at-date");
    for (const report of REPORTS) {
      const result = await loadReport(lab.admin, report.id, {
        from: "2000-01-01",
        to: today,
        asOf: today,
      });
      expect(result.meta.reportId, report.id).toBe(report.id);
      expect(messages.catalog[report.id]?.title, report.id).toBeTruthy();
      expect(messages.catalog[report.id]?.description, report.id).toBeTruthy();
    }
  });

  it("downloads CSV with a dated file name and the regulatory English column names", async () => {
    const { csv, filename } = await loadReportCsv(lab.admin, "destruction-register", {
      from: "2000-01-01",
      to: today,
    });
    expect(filename).toMatch(/^destruction-register-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain("Destruction date,Unit ID / name,Material type");
    expect(csv).toContain("Rep-B");
  });

  describe("state at a date", () => {
    it("reconstructs the inventory at the end of the chosen laboratory day", async () => {
      const now = await loadReport(lab.admin, "state-at-date", { asOf: today });
      expect(now.meta.reportId).toBe("state-at-date");
      expect(now.meta.periodLabel).toBe(`As of ${today}`);
      // Rep-A is in inventory, Rep-B was destroyed.
      expect(now.kpis?.find((k) => k.id === "activeUnits")?.value).toBe(1);

      const longAgo = await loadReport(lab.admin, "state-at-date", { asOf: "2020-01-01" });
      expect(longAgo.kpis?.find((k) => k.id === "activeUnits")?.value).toBe(0);
    });

    it("reads a day in the future as now, and narrows by location", async () => {
      const future = await loadReport(lab.admin, "state-at-date", { asOf: "2099-12-31" });
      expect(future.kpis?.find((k) => k.id === "activeUnits")?.value).toBe(1);
      const room3 = await loadReport(lab.admin, "state-at-date", {
        asOf: today,
        locationId: lab.rooms[2].id,
      });
      expect(room3.kpis?.find((k) => k.id === "activeUnits")?.value).toBe(1);
      const room1 = await loadReport(lab.admin, "state-at-date", {
        asOf: today,
        locationId: lab.rooms[0].id,
      });
      expect(room1.kpis?.find((k) => k.id === "activeUnits")?.value).toBe(0);
    });
  });

  describe("on-screen vocabulary stays in step with the generators", () => {
    it("knows every section, figure, column and CTLS line a report produces", async () => {
      for (const report of REPORTS) {
        const result = await runReport(report.id, { from: "2000-01-01", to: today, asOf: today });
        for (const kpi of result.kpis ?? []) {
          expect(isKpiId(kpi.id), `${report.id} figure "${kpi.label}"`).toBe(true);
          expect(messages.display.kpis[kpi.id!], `${kpi.id}`).toBeTruthy();
        }
        for (const section of result.sections) {
          expect(isSectionId(section.id), `${report.id} section "${section.title}"`).toBe(true);
          expect(messages.display.sections[section.id!], `${section.id}`).toBeTruthy();
          if (section.description) {
            expect(isSectionWithDescription(section.id), `${section.id} description`).toBe(true);
            expect(messages.display.sectionDescriptions[section.id!]).toBeTruthy();
          }
          for (const column of section.columns) {
            const key = resolveColumnKey(section.id, column.key);
            expect(key, `${section.id}.${column.key} ("${column.label}")`).not.toBeNull();
            expect(messages.display.columns[key!], `${key}`).toBeTruthy();
          }
        }
        for (const cls of result.ctls?.classes ?? []) {
          expect(messages.display.ctls.classes[cls.id], cls.id).toBeTruthy();
          for (const line of Object.keys(cls.lines)) {
            expect(messages.display.ctls.lines[line], `${cls.id}.${line}`).toBeTruthy();
          }
        }
      }
    });
  });
});
