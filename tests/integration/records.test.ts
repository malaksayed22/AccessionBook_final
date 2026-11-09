import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  GrowthStage,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
  TestPanel,
  UnitType,
} from "@/generated/prisma/enums";
import { buildExperimentRecord } from "@/features/experiment/record";
import { placeHold, recordLabTest, releaseHold } from "@/features/qa/service";
import type { RecordFile } from "@/features/record/common";
import { buildShipmentRecord } from "@/features/shipment/record";
import { createShipment } from "@/features/shipment/service";
import { recordActivity } from "@/features/unit/documents";
import { buildUnitRecord } from "@/features/unit/record";
import { changeStage, destroyUnit, measureUnit, moveUnit } from "@/features/unit/service";
import type { PdfBlock } from "@/lib/pdf/record-pdf";
import { renderRecordPdf } from "@/lib/pdf/record-pdf";
import { zonedDateKey } from "@/lib/lab-time";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

vi.mock("next-intl/server", () => import("../stubs/next-intl-server"));

// Before any module reads the environment.
vi.hoisted(() => {
  process.env.LAB_TIMEZONE = "America/Toronto";
  process.env.LAB_LICENSE_ID = "LIC-TEST-01";
});
const MS_PER_DAY = 86_400_000;
const dayKey = (daysAgo: number) =>
  zonedDateKey(new Date(Date.now() - daysAgo * MS_PER_DAY), "America/Toronto");

type Lab = Awaited<ReturnType<typeof createLab>>;

const section = (file: RecordFile, title: string) => {
  const found = file.record.sections.find((s) => s.title === title);
  expect(found, `section "${title}"`).toBeDefined();
  return found!.blocks;
};
const fieldsOf = (blocks: readonly PdfBlock[]) =>
  Object.fromEntries(
    blocks.flatMap((b) => (b.kind === "fields" ? b.fields.map((f) => [f.label, f.value]) : []))
  );
const figuresOf = (blocks: readonly PdfBlock[]) =>
  Object.fromEntries(
    blocks.flatMap((b) => (b.kind === "figures" ? b.figures.map((f) => [f.label, f]) : []))
  );
const rowsOf = (blocks: readonly PdfBlock[]) =>
  blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((row) => [...row]) : []));
const textOf = (blocks: readonly PdfBlock[]) =>
  blocks.flatMap((b) => (b.kind === "text" ? [b.text] : []));

/** The text drawn on a PDF's pages: content streams inflated, Helvetica's hex strings decoded. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
      parts.push(Buffer.from(hex[1]!, "hex").toString("latin1"));
    }
  }
  return parts.join("\n");
}

describe("unit and experiment records", () => {
  let lab: Lab;
  let flowerId: number;
  let plantId: number;

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();

    // A plant that went from vegetative to flowering, moved once, was held, then destroyed.
    plantId = (await registerOne(lab, { name: "REC-PLANT", effectiveAt: dayKey(30) })).id;
    await changeStage(lab.member, plantId, { toStage: "FLOWERING", effectiveAt: dayKey(10) });
    await moveUnit(lab.member, plantId, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await placeHold(lab.member, plantId, { kind: "HOLD", reason: "Mould spotted on a leaf" });
    await releaseHold(lab.admin, plantId, { note: "Cleared for destruction" });

    // Fresh flower weighed wet, dried, then shipped in part by dry weight.
    flowerId = (
      await registerOne(lab, {
        name: "REC-FLOWER",
        type: UnitType.FLOWER,
        growthStage: GrowthStage.HARVESTED,
        humidWeight: 500,
        effectiveAt: dayKey(20),
      } as never)
    ).id;
    await measureUnit(lab.member, flowerId, { dryWeight: 110 });
    await recordLabTest(lab.member, flowerId, {
      panel: TestPanel.POTENCY,
      wetWeight: 2,
      dryWeight: 0.5,
      labName: "Analytica",
    } as never);
    await createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: lab.provider.id,
      status: ShipmentStatus.IN_TRANSIT,
      items: [
        {
          unitId: flowerId,
          description: "Dried flower",
          materialType: MaterialClass.FLOWER,
          weightGrams: 10,
          moisture: "DRY",
        },
      ],
    } as never);

    await recordActivity(lab.member, flowerId, {
      type: "PESTICIDE",
      title: "Foliar spray",
      product: "Neem oil",
      pcpNumber: "30500",
      amount: 2.5,
      amountUnit: "L",
      method: "Spray",
    });

    await destroyUnit(lab.admin, plantId, { reason: "Mould, per SOP-14" } as never);
  });

  it("gives a flower's details, quantities, phases and every event", async () => {
    const file = (await buildUnitRecord(lab.member, flowerId, "en"))!;
    expect(file.filename).toMatch(/^unit-record-REC-FLOWER-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(file.record.title).toBe("Unit record");
    expect(file.record.subject).toBe("REC-FLOWER");
    expect(file.record.meta).toContain("Licence LIC-TEST-01");
    expect(file.record.meta[0]).toMatch(/^Generated .+ by Member$/);
    expect(file.record.qr?.url).toMatch(new RegExp(`/inventory/units/${flowerId}$`));

    expect(fieldsOf(section(file, "Details"))).toMatchObject({
      "Unit ID": String(flowerId),
      Type: "Flower",
      Status: "Active",
      Cultivar: "Northern Lights",
      Experiment: "AB1 · Test experiment",
      "Experiment lead": "Member",
      Location: "Room 1",
    });

    const figures = figuresOf(section(file, "Quantities"));
    expect(figures["Wet weight now"]?.value).toBe("500 g");
    // The dry weight as weighed, then what is left of it after the shipment.
    expect(figures["Original dry weight"]?.value).toBe("110 g");
    expect(figures["Remaining dry weight"]?.value).toBe("100 g");
    expect(figures["Remaining dry weight"]?.note).toBeUndefined();
    expect(figures.Shipped).toMatchObject({ value: "10 g dry", note: "1 shipment" });
    expect(figures["Lost in drying"]).toMatchObject({
      value: "390 g",
      note: "500 g wet dried to 110 g (78% of the wet weight)",
    });
    expect(figures.Destroyed).toBeUndefined();

    const events = rowsOf(section(file, "Event history"));
    expect(events.map((row) => row[2])).toEqual(["Created", "Measured", "Shipped (part)"]);
    // Each event lists what it changed: the weighing adds the dry weight, the shipment what left.
    expect(events[1]?.[3]).toBe("Dry 110 g");
    expect(events[2]?.[3]).toContain("Shipped 10 g dry");
    expect(events[2]?.[3]).toContain("Dry 100 g");
    expect(events[2]?.[3]).toContain("Counterparty: Seed Supplier Inc.");

    // Lab results are set aside for now: the record has no section for them.
    expect(file.record.sections.some((s) => s.title === "Lab results")).toBe(false);
    expect(textOf(section(file, "Holds"))).toEqual(["None recorded."]);
    expect(rowsOf(section(file, "Field records"))[0]?.slice(1)).toEqual([
      "Pesticide",
      "Foliar spray · Neem oil · PCP no. 30500 · 2.5 L · Spray",
      "Member",
    ]);
  });

  it("gives a destroyed plant's phases with their days, its hold and its destruction", async () => {
    const file = (await buildUnitRecord(lab.admin, plantId, "en"))!;
    expect(fieldsOf(section(file, "Details")).Status).toBe("Destroyed");

    // Twenty days vegetative; flowering ran from ten days ago to the destruction, today.
    const phases = rowsOf(section(file, "Phases"));
    expect(phases.map((row) => row[0])).toEqual(["Vegetative", "Flowering"]);
    expect(phases[0]?.[3]).toBe("20");
    expect(phases[1]?.[3]).toMatch(/^1[01]$/);
    expect(phases.every((row) => row[2] !== "Ongoing")).toBe(true);
    const total = section(file, "Phases").find((b) => b.kind === "table");
    expect(total?.kind === "table" && total.total).toEqual([
      "Total",
      "",
      "",
      String(20 + Number(phases[1]?.[3])),
    ]);

    expect(rowsOf(section(file, "Locations")).map((row) => row[0])).toEqual(["Room 1", "Room 2"]);
    expect(rowsOf(section(file, "Holds"))[0]?.slice(1)).toEqual([
      "Placed manually · Mould spotted on a leaf",
      expect.stringMatching(/ by Admin · Cleared for destruction$/),
    ]);
    expect(fieldsOf(section(file, "Destruction"))).toMatchObject({
      Reason: "Mould, per SOP-14",
      "Recorded by": "Admin",
    });
    // It held no weight, so the whole unit is what was destroyed.
    expect(figuresOf(section(file, "Quantities")).Destroyed).toMatchObject({
      value: "The whole unit",
      note: "What the unit held when destroyed",
    });
  });

  it("is written in the reader's language", async () => {
    const file = (await buildUnitRecord(lab.member, flowerId, "fr"))!;
    expect(file.record.title).toBe("Fiche de l’unité");
    expect(file.record.pageNumber(2, 5)).toBe("Page 2 sur 5");
    const figures = figuresOf(section(file, "Quantités"));
    // French puts a narrow no-break space before the unit; the PDF prints it as a no-break space.
    expect(figures["Expédié"]?.value).toBe("10\u202fg sec");
  });

  it("is only built for someone who can see the unit", async () => {
    expect(await buildUnitRecord(lab.outsider, flowerId, "en")).toBeNull();
    expect(await buildUnitRecord(lab.admin, 999_999, "en")).toBeNull();
    expect(await buildExperimentRecord(lab.outsider, lab.experiment.id, "en")).toBeNull();
  });

  it("gives an experiment's counts, quantities, phases and units", async () => {
    const file = (await buildExperimentRecord(lab.member, lab.experiment.id, "en"))!;
    expect(file.filename).toMatch(/^experiment-record-AB1-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(file.record.subject).toBe("AB1 · Test experiment");
    expect(fieldsOf(section(file, "Details"))).toMatchObject({
      Code: "AB1",
      Status: "Running",
      Lead: "Member",
    });

    const counts = figuresOf(section(file, "Unit counts"));
    expect(counts["Units registered"]?.value).toBe("2");
    expect(counts.Active?.value).toBe("1");
    expect(counts.Destroyed?.value).toBe("1");

    const quantities = figuresOf(section(file, "Quantities"));
    expect(quantities["Wet weight in stock"]?.value).toBe("500 g");
    expect(quantities["Dry weight in stock"]?.value).toBe("100 g");
    expect(quantities.Shipped).toMatchObject({ value: "10 g dry", note: "1 shipment" });
    expect(quantities["Lost in drying"]?.value).toBe("390 g");
    expect(quantities.Destroyed).toMatchObject({ value: "1 unit", note: undefined });
    // No seed lot is in stock: an unknown count reads as such, not as zero.
    expect(quantities["Seeds in stock"]?.value).toBe("—");

    expect(rowsOf(section(file, "Units")).map((row) => [row[0], row[5]])).toEqual([
      ["REC-FLOWER", "Active"],
      ["REC-PLANT", "Destroyed"],
    ]);
    expect(rowsOf(section(file, "Shipments out"))[0]?.[3]).toBe("10 g dry");
    expect(rowsOf(section(file, "Destructions"))[0]?.[2]).toBe("Mould, per SOP-14");
    expect(file.record.sections.some((s) => s.title === "Lab results")).toBe(false);
    expect(rowsOf(section(file, "Field records"))[0]?.slice(1, 4)).toEqual([
      "REC-FLOWER",
      "Pesticide",
      "Foliar spray · Neem oil · PCP no. 30500 · 2.5 L · Spray",
    ]);
    expect(rowsOf(section(file, "Phases")).map((row) => row[0])).toEqual(
      expect.arrayContaining(["Vegetative", "Flowering", "Harvested"])
    );
  });

  it("gives a shipment's chain of custody: counterparty, lines, history and signature lines", async () => {
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    const file = (await buildShipmentRecord(lab.admin, shipment.id, "en"))!;
    expect(file.filename).toMatch(/^chain-of-custody-.+\.pdf$/);
    expect(file.record.title).toBe("Chain of custody");
    expect(fieldsOf(section(file, "Shipment"))).toMatchObject({
      Direction: "Outbound",
      Status: "In transit",
      Counterparty: "Seed Supplier Inc.",
      Delivered: "Not delivered yet",
    });
    expect(rowsOf(section(file, "What travels"))[0]).toEqual([
      "1",
      "Dried flower",
      expect.any(String),
      "REC-FLOWER",
      "Northern Lights",
      "10 g dry",
    ]);
    expect(rowsOf(section(file, "Custody history")).length).toBeGreaterThan(0);
    expect(Object.keys(fieldsOf(section(file, "Signatures")))).toEqual([
      "Released by (name and signature)",
      "Date and time released",
      "Received by (name and signature)",
      "Date and time received",
    ]);
    expect(await buildShipmentRecord(lab.outsider, shipment.id, "en")).toBeNull();
  });

  it("renders to a PDF with the record's text on its pages", async () => {
    const file = (await buildUnitRecord(lab.member, flowerId, "fr"))!;
    const bytes = await renderRecordPdf(file.record);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const text = pdfText(bytes);
    expect(text).toContain("REC-FLOWER");
    expect(text).toContain("Fiche de l’unité".replace("’", "\x92"));
    expect(text).toContain("Historique des événements");
    expect(text).toMatch(/Page 1 sur \d+/);
  });
});
