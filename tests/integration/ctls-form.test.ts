import { beforeAll, describe, expect, it } from "vitest";
import {
  GrowthStage,
  MaterialClass,
  ShipmentDirection,
  SourceType,
  UnitType,
} from "@/generated/prisma/enums";
import { createOrganizationSchema } from "@/features/organization/schemas";
import { createOrganization, updateOrganization } from "@/features/organization/service";
import { loadCtlsFormCsv } from "@/features/report/queries";
import { createShipment } from "@/features/shipment/service";
import { changeStage, measureUnit } from "@/features/unit/service";
import { runReport } from "@/lib/reports";
import type { CtlsFormClass, ReportResult } from "@/lib/reports/types";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase } from "./helpers";

// The lab is in Toronto: every period below is a Toronto calendar period.
process.env.LAB_TIMEZONE = "America/Toronto";

type Lab = Awaited<ReturnType<typeof createLab>>;
type StageInput = Parameters<typeof changeStage>[2];
type MeasureInput = Parameters<typeof measureUnit>[2];

/** The lines of a class that are not zero (opening and closing always included). */
function nonZero(result: ReportResult, id: CtlsFormClass["id"]) {
  const cls = result.ctls?.classes.find((c) => c.id === id);
  if (!cls) throw new Error(`CTLS class ${id} missing`);
  return Object.fromEntries(
    Object.entries(cls.lines).filter(
      ([line, value]) => value !== 0 || line === "opening" || line === "closing"
    )
  );
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("CTLS monthly form: classes, transformations and counterparties", () => {
  let lab: Lab;
  let march: ReportResult;
  const id: Record<string, number> = {};
  const org: Record<string, number> = {};

  const ship = (organizationId: number, shippedDate: string, item: Record<string, unknown>) =>
    createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId,
      status: "IN_TRANSIT",
      shippedDate,
      items: [{ description: "Line", ...item }],
    } as Parameters<typeof createShipment>[1]);

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    const register = async (name: string, extra: Record<string, unknown>) => {
      id[name] = (await registerOne(lab, { name, ...extra } as never)).id;
    };

    org.tester = (
      await createOrganization(lab.admin, {
        address: "1 Test Street, Quebec City",
        name: "Quebec Testing Lab",
        country: "Canada",
        licenceClass: "ANALYTICAL_TESTING",
      })
    ).id;
    org.university = (
      await createOrganization(lab.admin, {
        address: "1 Test Street, Quebec City",
        name: "Partner University",
        country: "Canada",
        licenceClass: "RESEARCH",
      })
    ).id;
    org.abroad = (
      await createOrganization(lab.admin, {
        address: "1 Test Street, Quebec City",
        name: "Dutch Seed Bank",
        country: "Netherlands",
      })
    ).id;

    // Harvested material: fresh (wet only) and dried (a dry weight recorded).
    await register("FRESH-1", {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 100,
      effectiveAt: "2025-03-03T15:00:00Z",
    });
    await register("DRIED-1", {
      type: UnitType.FLOWER,
      growthStage: GrowthStage.CURING,
      humidWeight: 100,
      dryWeight: 25,
      effectiveAt: "2025-03-03T15:00:00Z",
    });
    // Seeds: internal stock, and a lot received from abroad.
    await register("SEEDS-1", {
      type: UnitType.SEEDLOT,
      seedCount: 50,
      growthStage: undefined,
      effectiveAt: "2025-03-03T15:00:00Z",
    });
    await register("IMPORT-1", {
      type: UnitType.SEEDLOT,
      seedCount: 20,
      growthStage: undefined,
      sourceType: SourceType.RECEIVED,
      sourceDescription: undefined,
      providerOrganizationId: org.abroad,
      effectiveAt: "2025-03-04T15:00:00Z",
    });
    // A plant grown, flowered, harvested, weighed, then dried.
    await register("PLANT-1", { effectiveAt: "2025-03-03T15:00:00Z" });
    const stage = (toStage: GrowthStage, effectiveAt: string) =>
      changeStage(lab.member, id["PLANT-1"]!, { toStage, effectiveAt } as StageInput);
    await stage(GrowthStage.FLOWERING, "2025-03-10T15:00:00Z");
    await stage(GrowthStage.HARVESTED, "2025-03-20T15:00:00Z");
    await measureUnit(lab.member, id["PLANT-1"]!, {
      humidWeight: 400,
      effectiveAt: "2025-03-21T15:00:00Z",
    } as MeasureInput);
    await measureUnit(lab.member, id["PLANT-1"]!, {
      dryWeight: 90,
      effectiveAt: "2025-03-28T15:00:00Z",
    } as MeasureInput);

    // Shipments: by recipient class, abroad, and to a supplier with neither class nor country.
    await ship(org.tester!, "2025-03-15", {
      unitId: id["FRESH-1"],
      materialType: MaterialClass.FLOWER,
      weightGrams: 30,
      moisture: "WET",
    });
    await ship(org.university!, "2025-03-16", {
      unitId: id["DRIED-1"],
      materialType: MaterialClass.FLOWER,
      weightGrams: 5,
      moisture: "DRY",
    });
    await ship(org.abroad!, "2025-03-16", {
      unitId: id["SEEDS-1"],
      materialType: MaterialClass.SEED,
      unitCount: 20,
    });
    await ship(lab.provider.id, "2025-03-17", {
      unitId: id["SEEDS-1"],
      materialType: MaterialClass.SEED,
      unitCount: 10,
    });
    await ship(org.tester!, "2025-03-18", {
      materialType: MaterialClass.TRIM,
      weightGrams: 12,
      moisture: "WET",
    });
    // The rest of the fresh flower leaves: the unit has nothing left.
    await ship(org.tester!, "2025-03-25", {
      unitId: id["FRESH-1"],
      materialType: MaterialClass.FLOWER,
      weightGrams: 70,
      moisture: "WET",
    });

    march = await runReport("ctls-monthly", { year: 2025, month: 3 });
  });

  it("reconciles every class", () => {
    expect(march.ctls?.reconciles).toBe(true);
    expect(march.ctls?.classes.every((c) => c.reconciles)).toBe(true);
  });

  it("moves a plant from vegetative to whole plants, then out when harvested", () => {
    expect(nonZero(march, "vegetativePlants")).toEqual({
      opening: 0,
      additionsOther: 1,
      processed: 1,
      closing: 0,
    });
    expect(nonZero(march, "wholePlants")).toEqual({
      opening: 0,
      produced: 1,
      processed: 1,
      closing: 0,
    });
  });

  it("reports fresh cannabis by wet weight, with the drying loss, in kilograms", () => {
    // FRESH-1: 100 g in, all shipped to the testing lab. PLANT-1: 400 g produced when weighed,
    // 90 g dried (processed into dried cannabis) and 310 g of moisture lost.
    expect(nonZero(march, "freshCannabis")).toEqual({
      opening: 0,
      produced: 0.4,
      additionsOther: 0.1,
      processed: 0.09,
      shippedTesters: 0.1,
      dryingLoss: 0.31,
      closing: 0,
    });
  });

  it("reports dried cannabis by dry weight, shipped to researchers", () => {
    expect(nonZero(march, "driedCannabis")).toEqual({
      opening: 0,
      produced: 0.09,
      additionsOther: 0.025,
      shippedResearchers: 0.005,
      closing: 0.11,
    });
  });

  it("reports seeds received from abroad as imported and seeds sent abroad as exported", () => {
    expect(nonZero(march, "seeds")).toEqual({
      opening: 0,
      receivedImported: 20,
      additionsOther: 50,
      exported: 20,
      reductionsOther: 10,
      closing: 40,
    });
  });

  it("lists what to check before filing", () => {
    expect(march.ctls?.issues).toEqual({
      licenceIdMissing: true,
      countryMissing: ["Seed Supplier Inc."],
      recipientUnclassified: ["Seed Supplier Inc."],
      unweighed: [],
      trimShipped: { lines: 1, grams: 12 },
    });
  });

  it("refuses to ship a dried flower by wet weight", async () => {
    const error = await failure(
      ship(org.university!, "2025-03-29", {
        unitId: id["DRIED-1"],
        materialType: MaterialClass.FLOWER,
        weightGrams: 5,
        moisture: "WET",
      })
    );
    expect(error.details).toMatchObject({ reason: "driedShipsDry" });
  });

  it("downloads the form's columns A to JS with the licence and the month", async () => {
    const { csv, filename } = await loadCtlsFormCsv(lab.admin, {
      year: 2025,
      month: 3,
      licenseId: "LIC-TEST",
    });
    expect(filename).toBe("LIC-TEST-ctls-2025-03.csv");
    const [header, data] = csv.split("\r\n");
    const headers = header!.split(",");
    const cells = data!.split(",");
    expect(headers).toHaveLength(279);
    const cell = (name: string) => cells[headers.indexOf(name)];
    expect(cells.slice(0, 3)).toEqual(["2025", "03", "LIC-TEST"]);
    expect(cell("Unpackaged - Seeds - Reductions - Shipped - exported (#)")).toBe("20");
    expect(cell("Unpackaged - Seeds - Additions - Received - imported (#)")).toBe("20");
    expect(
      cell(
        "Unpackaged - Fresh cannabis - Reductions - Adjustment for drying / processing loss (kg)"
      )
    ).toBe("0.31");
    expect(
      cell("Unpackaged - Dried cannabis - Reductions - Shipped - domestic - to researchers (kg)")
    ).toBe("0.005");
    expect(cell("Unpackaged - Dried cannabis - Closing inventory (kg)")).toBe("0.11");
  });

  it("keeps the CTLS form for administrators", async () => {
    const error = await failure(loadCtlsFormCsv(lab.member, { year: 2025, month: 3 }));
    expect(error.code).toBe("FORBIDDEN");
  });
});

describe("organization licence class", () => {
  it("is stored, changed and cleared, with each change in the audit trail", async () => {
    await resetDatabase();
    const lab = await createLab();
    const { id } = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Analytical Partner",
      licenceClass: "ANALYTICAL_TESTING",
    });
    const read = async () =>
      (await prisma.organization.findUniqueOrThrow({ where: { id } })).licenceClass;
    expect(await read()).toBe("ANALYTICAL_TESTING");

    await updateOrganization(lab.admin, id, { licenceClass: "RESEARCH" });
    expect(await read()).toBe("RESEARCH");
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "organization", entityId: id, action: "update" },
      orderBy: { id: "desc" },
    });
    expect(JSON.stringify(audit?.details)).toContain("licence class");

    await updateOrganization(lab.admin, id, { licenceClass: null });
    expect(await read()).toBeNull();
  });

  it("accepts only Health Canada's licence classes, and an empty choice as none", () => {
    expect(() =>
      createOrganizationSchema.parse({
        name: "Lab",
        address: "1 Test Street",
        licenceClass: "BAKERY",
      })
    ).toThrow();
    expect(
      createOrganizationSchema.parse({ name: "Lab", address: "1 Test Street", licenceClass: "" })
        .licenceClass
    ).toBeNull();
  });
});
