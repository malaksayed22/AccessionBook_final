import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GrowthStage,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
  UnitType,
} from "@/generated/prisma/enums";
import { buildLabels, labelResponse } from "@/features/label/build";
import { labelRequestSchema } from "@/features/label/schemas";
import { createShipment } from "@/features/shipment/service";
import { takeSample } from "@/features/unit/samples";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

vi.mock("next-intl/server", () => import("../stubs/next-intl-server"));

type Lab = Awaited<ReturnType<typeof createLab>>;
const request = (query: Record<string, string>) => labelRequestSchema.parse(query);

describe("labels", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("prints copies of a unit's label, for those who may read the unit", async () => {
    const unit = await registerOne(lab, { name: "AB1-P-01" });
    const file = await buildLabels(
      lab.member,
      request({ for: "unit", id: String(unit.id), template: "avery-5160", copies: "3" }),
      "en"
    );
    expect(file?.document.labels).toHaveLength(3);
    expect(file?.document.labels[0]).toMatchObject({
      title: "AB1-P-01",
      lines: ["Plant · Northern Lights", "Experiment AB1"],
      barcode: "AB1-P-01",
    });
    expect(file?.filename).toMatch(/^labels-AB1-P-01-avery-5160-\d{4}-\d{2}-\d{2}\.pdf$/);
    // A member of another experiment cannot print it.
    expect(
      await buildLabels(
        lab.outsider,
        request({ for: "unit", id: String(unit.id), template: "zebra-2x1" }),
        "en"
      )
    ).toBeNull();

    // A group of plants says how many it holds.
    const group = await registerOne(lab, { name: "AB1-G-01", plantCount: 25 } as never);
    const grouped = await buildLabels(
      lab.member,
      request({ for: "unit", id: String(group.id), template: "avery-5163" }),
      "en"
    );
    expect(grouped?.document.labels[0]?.lines).toContain("25 plants");

    const response = await labelResponse(file!);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(1);
  });

  it("labels an experiment's units in stock, a sample saying what it was taken from", async () => {
    const flower = await registerOne(lab, {
      name: "AB1-F-01",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.CURING,
      humidWeight: 500,
      dryWeight: 100,
    } as never);
    await takeSample(lab.member, flower.id, { kind: "RELEASE", amount: 2 });
    const file = await buildLabels(
      lab.member,
      request({
        for: "experiment",
        id: String(lab.experiment.id),
        template: "avery-5167",
        skip: "4",
      }),
      "en"
    );
    expect(file?.document.skip).toBe(4);
    expect(file?.document.labels.map((l) => l.title)).toEqual(["AB1-F-01", "AB1-F-01-S-1"]);
    expect(file?.document.labels[1]?.lines).toContain("Sample of AB1-F-01");
  });

  it("labels a shipment and the lab's locations", async () => {
    const unit = await registerOne(lab, { name: "AB1-P-02" });
    const shipment = await createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      status: ShipmentStatus.DRAFT,
      organizationId: lab.provider.id,
      items: [
        { unitId: unit.id, description: "Plant", materialType: MaterialClass.PLANT, unitCount: 1 },
      ],
    } as never);
    const shipped = await buildLabels(
      lab.admin,
      request({ for: "shipment", id: String(shipment.id), template: "zebra-4x2" }),
      "en"
    );
    expect(shipped?.document.labels[0]).toMatchObject({
      title: shipment.reference,
      lines: ["To Seed Supplier Inc.", "1 line"],
      barcode: shipment.reference,
    });

    await prisma.location.update({
      where: { id: lab.rooms[1].id },
      data: { parentId: lab.rooms[0].id, kind: "RACK", capacity: 30, capacityMeasure: "PLANTS" },
    });
    await prisma.location.update({ where: { id: lab.rooms[2].id }, data: { active: false } });
    const rooms = await buildLabels(
      lab.member,
      request({ for: "location", template: "avery-5163" }),
      "en"
    );
    expect(rooms?.document.labels.map((l) => [l.title, l.lines])).toEqual([
      ["Room 1", ["Room"]],
      ["Room 2", ["Rack · in Room 1", "Holds 30 plants"]],
    ]);
    expect(rooms?.document.labels[0]?.qr).toMatch(/\/inventory\/units\?location=\d+$/);
  });

  it("refuses a stock it does not know", () => {
    expect(
      labelRequestSchema.safeParse({ for: "unit", id: "1", template: "dymo-99" }).success
    ).toBe(false);
  });
});
