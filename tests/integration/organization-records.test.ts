import { beforeEach, describe, expect, it } from "vitest";
import {
  MaterialClass,
  Moisture,
  ShipmentDirection,
  ShipmentStatus,
  TestPanel,
} from "@/generated/prisma/enums";
import {
  getOrganizationDetail,
  listOrganizationCountries,
  listOrganizationOptions,
  listOrganizations,
  type OrganizationListParams,
} from "@/features/organization/queries";
import { createOrganization } from "@/features/organization/service";
import { recordLabTest, voidLabTest } from "@/features/qa/service";
import { createShipment, voidShipment } from "@/features/shipment/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const base: OrganizationListParams = { sort: "name", order: "asc", page: 1, limit: 10 };
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);
const pages = { inbound: 1, outbound: 1, units: 1, tests: 1 };

const inbound = (lab: Lab, organizationId: number, status: ShipmentStatus, items: object[]) =>
  createShipment(lab.admin, {
    direction: ShipmentDirection.INBOUND,
    organizationId,
    status,
    items,
  } as Parameters<typeof createShipment>[1]);

describe("organization queries", () => {
  let lab: Lab;
  let recipient: { id: number };
  let analytica: { id: number };
  let unitId: number;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab(); // supplier "Seed Supplier Inc."
    await prisma.organization.update({
      where: { id: lab.provider.id },
      data: { country: "CA", licenceNumber: "LIC-1", address: "12 Farm Road" },
    });
    recipient = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Recipient Ltd",
      country: "US",
    });
    analytica = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Analytica Labs",
      country: "CA",
    });
    await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Idle Partner",
    });

    const unit = await registerOne(lab, { name: "P1" });
    unitId = unit.id;
    await prisma.biologicalUnit.update({
      where: { id: unitId },
      data: { providerOrganizationId: lab.provider.id },
    });
  });

  it("tells suppliers, recipients and labs apart from their records", async () => {
    // Received from the supplier, a result by the lab, then sent to the recipient.
    await recordLabTest(lab.member, unitId, {
      panel: TestPanel.POTENCY,
      analyte: "THC",
      value: 15,
      labName: "  analytica labs ",
    });
    await inbound(lab, lab.provider.id, ShipmentStatus.DELIVERED, [
      { description: "Seeds", materialType: MaterialClass.SEED, unitCount: 100 },
    ]);
    await createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: recipient.id,
      status: ShipmentStatus.IN_TRANSIT,
      items: [{ unitId, description: "Plant", materialType: MaterialClass.PLANT, unitCount: 1 }],
    } as Parameters<typeof createShipment>[1]);

    const rows = (await listOrganizations(lab.admin, base)).rows;
    const relationsOf = Object.fromEntries(rows.map((r) => [r.name, r.relations]));
    expect(relationsOf).toEqual({
      "Analytica Labs": ["lab"],
      "Idle Partner": [],
      "Recipient Ltd": ["recipient"],
      "Seed Supplier Inc.": ["supplier"],
    });

    for (const [relation, expected] of [
      ["supplier", ["Seed Supplier Inc."]],
      ["recipient", ["Recipient Ltd"]],
      ["lab", ["Analytica Labs"]],
    ] as const) {
      expect(names((await listOrganizations(lab.admin, { ...base, relation })).rows)).toEqual(
        expected
      );
    }
  });

  it("filters by country and searches name, address and licence without wildcards", async () => {
    expect(names((await listOrganizations(lab.admin, { ...base, country: "ca" })).rows)).toEqual([
      "Analytica Labs",
      "Seed Supplier Inc.",
    ]);
    expect(await listOrganizationCountries()).toEqual(["CA", "US"]);
    expect(names((await listOrganizations(lab.admin, { ...base, q: "farm road" })).rows)).toEqual([
      "Seed Supplier Inc.",
    ]);
    expect(names((await listOrganizations(lab.admin, { ...base, q: "lic-1" })).rows)).toEqual([
      "Seed Supplier Inc.",
    ]);
    expect((await listOrganizations(lab.admin, { ...base, q: "%" })).total).toBe(0);
    expect((await listOrganizations(lab.admin, { ...base, q: "_" })).total).toBe(0);
    expect(
      (await listOrganizations(lab.admin, { ...base, q: '\'; DROP TABLE "Organization"; --' }))
        .total
    ).toBe(0);
  });

  it("sorts and pages without repeating rows", async () => {
    expect(
      names((await listOrganizations(lab.admin, { ...base, sort: "units", order: "desc" })).rows)[0]
    ).toBe("Seed Supplier Inc.");
    const first = await listOrganizations(lab.admin, { ...base, limit: 3 });
    const second = await listOrganizations(lab.admin, { ...base, limit: 3, page: 2 });
    expect(first.total).toBe(4);
    expect([...names(first.rows), ...names(second.rows)]).toEqual([
      "Analytica Labs",
      "Idle Partner",
      "Recipient Ltd",
      "Seed Supplier Inc.",
    ]);
    expect((await listOrganizationOptions()).map((o) => o.name)).toHaveLength(4);
  });

  it("counts moved material only: drafts, cancelled and voided shipments stay out", async () => {
    const line = (count: number) => [
      { description: "Seeds", materialType: MaterialClass.SEED, unitCount: count },
    ];
    await inbound(lab, lab.provider.id, ShipmentStatus.DELIVERED, [
      ...line(100),
      {
        description: "Flower",
        materialType: MaterialClass.FLOWER,
        weightGrams: 12.5,
        moisture: Moisture.DRY,
      },
    ]);
    await inbound(lab, lab.provider.id, ShipmentStatus.IN_TRANSIT, line(50));
    await inbound(lab, lab.provider.id, ShipmentStatus.DRAFT, line(1000));
    const voided = await inbound(lab, lab.provider.id, ShipmentStatus.DRAFT, line(7));
    await voidShipment(lab.admin, voided.id, { reason: "Recorded in error" });

    const detail = (await getOrganizationDetail(lab.admin, lab.provider.id, pages))!;
    expect(detail.inboundTotals).toMatchObject({ seeds: 150, dryGrams: 12.5, wetGrams: 0 });
    expect(detail.outboundTotals.seeds).toBe(0);
    // Listed: delivered, in transit and the draft; the voided draft is not.
    expect(detail.inbound.total).toBe(3);
    expect(detail.counts.shipments).toBe(3);
    expect(detail.counts.suppliedUnits).toBe(1);
  });

  it("pages each shipment table on its own", async () => {
    for (let i = 0; i < 12; i++) {
      await inbound(lab, lab.provider.id, ShipmentStatus.DELIVERED, [
        { description: "Seeds", materialType: MaterialClass.SEED, unitCount: 1 },
      ]);
    }
    const first = (await getOrganizationDetail(lab.admin, lab.provider.id, pages))!;
    const second = (await getOrganizationDetail(lab.admin, lab.provider.id, {
      ...pages,
      inbound: 2,
    }))!;
    expect(first.inbound.total).toBe(12);
    expect(first.inbound.rows).toHaveLength(10);
    expect(second.inbound.rows).toHaveLength(2);
    const ids = [...first.inbound.rows, ...second.inbound.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(12);
  });

  it("lists tests performed by the lab and tests on the units a supplier provided", async () => {
    await recordLabTest(lab.member, unitId, {
      panel: TestPanel.POTENCY,
      analyte: "THC",
      value: 15,
      labName: "Analytica Labs",
    });
    const voidedTest = await recordLabTest(lab.member, unitId, {
      panel: TestPanel.TERPENES,
      analyte: "Limonene",
      value: 1,
    });
    await voidLabTest(lab.admin, voidedTest.testId, { reason: "Entered on the wrong unit" });

    const labDetail = (await getOrganizationDetail(lab.admin, analytica.id, pages))!;
    expect(labDetail.tests.rows.map((t) => [t.analyte, t.relation])).toEqual([
      ["THC", "performed"],
    ]);
    const supplierDetail = (await getOrganizationDetail(lab.admin, lab.provider.id, pages))!;
    expect(supplierDetail.tests.rows.map((t) => [t.analyte, t.relation])).toEqual([
      ["THC", "supplied"],
    ]);
    expect(supplierDetail.units.rows.map((u) => u.name)).toEqual(["P1"]);
    expect((await getOrganizationDetail(lab.admin, recipient.id, pages))!.tests.total).toBe(0);
  });

  it("returns the profile activity and null for an unknown organization", async () => {
    const detail = (await getOrganizationDetail(lab.admin, recipient.id, pages))!;
    expect(detail.activity.map((a) => a.summary)).toEqual([
      "Registered provider organization Recipient Ltd",
    ]);
    expect(detail.organization.country).toBe("US");
    expect(await getOrganizationDetail(lab.admin, 99999, pages)).toBeNull();
  });
});
