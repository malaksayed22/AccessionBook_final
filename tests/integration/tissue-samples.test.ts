import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthStage, UnitType } from "@/generated/prisma/enums";
import { buildLabels } from "@/features/label/build";
import { labelRequestSchema } from "@/features/label/schemas";
import { recordLabTest } from "@/features/qa/service";
import { getUnitQuality } from "@/features/unit/detail-queries";
import { takeTissueSample } from "@/features/unit/tissue";
import { AppError } from "@/server/errors";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase, statesOf } from "./helpers";

vi.mock("next-intl/server", () => import("../stubs/next-intl-server"));

type Lab = Awaited<ReturnType<typeof createLab>>;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("tissue samples", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("takes a coded sample of a plant without changing its stock, and records results on it", async () => {
    const plant = await registerOne(lab, { name: "M-1" });
    const before = await statesOf(plant.id);
    const first = await takeTissueSample(lab.member, plant.id, {
      purpose: "PATHOGEN",
      tissue: "LEAF",
      note: "Youngest fan leaf",
    });
    const second = await takeTissueSample(lab.member, plant.id, {
      purpose: "SEX",
      tissue: "LEAF",
    });
    expect([first.code, second.code]).toEqual(["M-1-T-1", "M-1-T-2"]);
    // Nothing is added to the unit's history: the piece does not change what it counts for.
    expect(await statesOf(plant.id)).toHaveLength(before.length);

    await recordLabTest(lab.member, plant.id, {
      panel: "PATHOGENS",
      analyte: "HLVd",
      comment: "Not detected",
      tissueSampleId: first.id,
    });
    const quality = await getUnitQuality(lab.member, plant.id);
    expect(quality.tissueSamples.map((s) => [s.code, s.purpose, s.tests])).toEqual([
      ["M-1-T-2", "SEX", 0],
      ["M-1-T-1", "PATHOGEN", 1],
    ]);
    expect(quality.tests[0]).toMatchObject({ panel: "PATHOGENS", sample: "M-1-T-1" });

    // A result cannot point at another unit's sample.
    const other = await registerOne(lab, { name: "M-2" });
    expect(
      (
        await failure(
          recordLabTest(lab.member, other.id, {
            panel: "PATHOGENS",
            comment: "x",
            tissueSampleId: first.id,
          })
        )
      ).code
    ).toBe("VALIDATION");

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "unit", entityId: plant.id, action: "tissue_sample" },
    });
    expect(audit).toHaveLength(2);
  });

  it("is for plants and cultures, by those who may record quality, with a label", async () => {
    const flower = await registerOne(lab, {
      name: "F-1",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.DRYING,
      humidWeight: 100,
    } as never);
    expect(
      (await failure(takeTissueSample(lab.member, flower.id, { purpose: "OTHER", tissue: "LEAF" })))
        .details
    ).toMatchObject({ reason: "tissueNotApplicable" });

    const culture = await registerOne(lab, { name: "TC-1", type: UnitType.CULTURE } as never);
    expect(
      (
        await failure(
          takeTissueSample(lab.outsider, culture.id, { purpose: "PATHOGEN", tissue: "MEDIUM" })
        )
      ).code
    ).toBe("FORBIDDEN");
    const sample = await takeTissueSample(lab.member, culture.id, {
      purpose: "PATHOGEN",
      tissue: "MEDIUM",
    });

    const file = await buildLabels(
      lab.member,
      labelRequestSchema.parse({ for: "tissue", id: String(sample.id), template: "avery-5167" }),
      "en"
    );
    expect(file?.document.labels[0]).toMatchObject({
      title: "TC-1-T-1",
      barcode: "TC-1-T-1",
    });
    expect(file?.document.labels[0]?.lines.slice(0, 2)).toEqual([
      "Pathogen screen · Culture medium",
      "From TC-1",
    ]);
    // Someone outside the experiment gets no label.
    expect(
      await buildLabels(
        lab.outsider,
        labelRequestSchema.parse({ for: "tissue", id: String(sample.id), template: "avery-5167" }),
        "en"
      )
    ).toBeNull();
  });
});
