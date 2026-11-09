import { beforeEach, describe, expect, it } from "vitest";
import {
  HoldKind,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
} from "@/generated/prisma/enums";
import {
  getShipmentDetail,
  getShipmentStats,
  listShipments,
  searchShippableUnits,
  type ShipmentListParams,
} from "@/features/shipment/queries";
import { createShipment, updateShipment, voidShipment } from "@/features/shipment/service";
import { placeHold } from "@/features/qa/service";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

process.env.LAB_TIMEZONE = "America/Toronto";

const base: ShipmentListParams = { sort: "reference", order: "asc", page: 1, limit: 10 };
const refs = (rows: Array<{ reference: string }>) => rows.map((r) => r.reference);

describe("shipment list, stats and detail", () => {
  let lab: Lab;
  let other: { id: number };
  const made: Record<string, { id: number; reference: string }> = {};

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    other = await prisma.organization.create({
      data: { name: "Beta Labs", licenceNumber: "LIC-BETA-9" },
    });

    const unitA = await registerOne(lab, { name: "Shippable A" });
    const unitB = await registerOne(lab, { name: "Held B" });
    await placeHold(lab.member, unitB.id, { reason: "Suspected mould", kind: HoldKind.HOLD });

    // 1. inbound seeds, delivered on a known day
    made.inbound = await createShipment(lab.admin, {
      direction: ShipmentDirection.INBOUND,
      organizationId: lab.provider.id,
      status: ShipmentStatus.DELIVERED,
      deliveredDate: "2026-03-10",
      items: [
        { description: "Northern Lights seeds", materialType: MaterialClass.SEED, unitCount: 100 },
      ],
    } as Parameters<typeof createShipment>[1]);
    // 2. outbound draft of a unit and a weighed line, to another organization
    made.draft = await createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: other.id,
      trackingNumber: "TRACK-50%_OFF",
      items: [
        {
          unitId: unitA.id,
          description: "Plant A",
          materialType: MaterialClass.PLANT,
          unitCount: 1,
        },
        {
          // Trim is the one material that leaves on a free line: it is not tracked as a unit.
          description: "Dry trim",
          materialType: MaterialClass.TRIM,
          weightGrams: 12.5,
          moisture: "DRY",
        },
      ],
    } as Parameters<typeof createShipment>[1]);
    // 3. outbound in transit with a shipped-on day
    made.transit = await createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: lab.provider.id,
      status: ShipmentStatus.IN_TRANSIT,
      shippedDate: "2026-04-02",
      items: [
        {
          description: "Bulk trim",
          materialType: MaterialClass.TRIM,
          weightGrams: 3,
          moisture: "WET",
        },
      ],
    } as Parameters<typeof createShipment>[1]);
    // 4. a draft that is voided: must never appear anywhere
    const voided = await createShipment(lab.admin, {
      direction: ShipmentDirection.INBOUND,
      organizationId: lab.provider.id,
      items: [{ description: "Voided seeds", materialType: MaterialClass.SEED, unitCount: 999 }],
    } as Parameters<typeof createShipment>[1]);
    await voidShipment(lab.admin, voided.id, { reason: "Created in error" });
  });

  it("lists every live shipment and never a voided one", async () => {
    const { rows, total } = await listShipments(lab.admin, base);
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.lineCount).sort()).toEqual([1, 1, 2]);
  });

  it("filters by direction, status and organization", async () => {
    expect((await listShipments(lab.admin, { ...base, direction: "INBOUND" })).total).toBe(1);
    expect((await listShipments(lab.admin, { ...base, direction: "OUTBOUND" })).total).toBe(2);
    expect(refs((await listShipments(lab.admin, { ...base, status: "DRAFT" })).rows)).toEqual([
      made.draft!.reference,
    ]);
    expect(
      refs((await listShipments(lab.admin, { ...base, organizationId: other.id })).rows)
    ).toEqual([made.draft!.reference]);
  });

  it("searches reference, tracking, organization, line and unit, ignoring case", async () => {
    const find = async (q: string) => refs((await listShipments(lab.admin, { ...base, q })).rows);
    expect(await find(made.transit!.reference.toLowerCase())).toEqual([made.transit!.reference]);
    expect(await find("beta lab")).toEqual([made.draft!.reference]);
    expect(await find("northern lights")).toEqual([made.inbound!.reference]);
    expect(await find("shippable a")).toEqual([made.draft!.reference]);
    expect(await find("nothing like this")).toEqual([]);
  });

  it("treats search text as text, not as a pattern or SQL", async () => {
    const count = async (q: string) => (await listShipments(lab.admin, { ...base, q })).total;
    // Only the tracking number that really contains a % (and an _) matches; no wildcard.
    expect(await count("%")).toBe(1);
    expect(await count("_")).toBe(1);
    expect(await count("%%")).toBe(0);
    expect(await count("_____")).toBe(0);
    expect(await count("50%_OFF")).toBe(1);
    expect(await count("50%X")).toBe(0);
    expect(await count(`'; DROP TABLE "Shipment"; --`)).toBe(0);
    expect(await count("")).toBe(3);
  });

  it("filters by movement date in the laboratory time zone", async () => {
    // Inbound is filed on the day it arrived, outbound on the day it left.
    const inRange = async (from?: string, to?: string) =>
      refs((await listShipments(lab.admin, { ...base, from, to })).rows);
    expect(await inRange("2026-03-10", "2026-03-10")).toEqual([made.inbound!.reference]);
    expect(await inRange("2026-04-02", "2026-04-02")).toEqual([made.transit!.reference]);
    expect(await inRange("2026-03-11", "2026-04-01")).toEqual([]);
    expect((await inRange("2026-03-10")).length).toBe(3);
    expect(await inRange(undefined, "2026-03-31")).toEqual([made.inbound!.reference]);
  });

  it("sorts both ways, including by the date shown, and pages without repeating rows", async () => {
    const byDate = await listShipments(lab.admin, { ...base, sort: "date", order: "asc" });
    // 2026-03-10 inbound, 2026-04-02 transit, then the draft recorded now.
    expect(refs(byDate.rows)).toEqual([
      made.inbound!.reference,
      made.transit!.reference,
      made.draft!.reference,
    ]);
    expect(
      refs((await listShipments(lab.admin, { ...base, sort: "date", order: "desc" })).rows)
    ).toEqual(refs(byDate.rows).reverse());
    expect(
      (await listShipments(lab.admin, { ...base, sort: "organization", order: "asc" })).rows[0]
        ?.organization.name
    ).toBe("Beta Labs");

    const first = await listShipments(lab.admin, { ...base, limit: 2 });
    const second = await listShipments(lab.admin, { ...base, limit: 2, page: 2 });
    expect(first.total).toBe(3);
    expect([...refs(first.rows), ...refs(second.rows)]).toEqual(
      refs((await listShipments(lab.admin, base)).rows)
    );
  });

  it("totals what was received and shipped, counting only what actually moved", async () => {
    const stats = await getShipmentStats(lab.admin, {});
    expect(stats.received).toMatchObject({ count: 1, totals: { seeds: 100 } });
    expect(stats.shipped).toMatchObject({ count: 1, totals: { wetGrams: 3, dryGrams: 0 } });
    expect(stats.inTransit).toBe(1);
    expect(stats.drafts).toBe(1);
    // The same date range as the list.
    const march = await getShipmentStats(lab.admin, { from: "2026-03-01", to: "2026-03-31" });
    expect(march.received.count).toBe(1);
    expect(march.shipped.count).toBe(0);
  });

  it("returns a shipment's lines, unit standing and history, and null for a voided one", async () => {
    const detail = await getShipmentDetail(lab.admin, made.draft!.id);
    expect(detail).toMatchObject({
      reference: made.draft!.reference,
      status: "DRAFT",
      organization: { name: "Beta Labs", licenceNumber: "LIC-BETA-9" },
      unitLineCount: 1,
    });
    expect(detail?.items.find((i) => i.unit)?.unitStanding).toBe("active");
    expect(detail?.totals).toMatchObject({ plants: 1, dryGrams: 12.5 });
    expect(detail?.timeline.map((e) => [e.action, e.statusTo])).toEqual([["create", "DRAFT"]]);

    await updateShipment(lab.admin, made.draft!.id, { status: ShipmentStatus.IN_TRANSIT });
    const after = await getShipmentDetail(lab.admin, made.draft!.id);
    // Shipping is not a status: the plant shipped whole and is still active, with nothing left.
    expect(after?.items.find((i) => i.unit)?.unitStanding).toBe("active");
    expect(after?.timeline.at(-1)).toMatchObject({
      action: "update",
      statusFrom: "DRAFT",
      statusTo: "IN_TRANSIT",
      actor: "Admin",
    });

    const voidedId = (
      await prisma.shipment.findFirstOrThrow({ where: { voidedAt: { not: null } } })
    ).id;
    expect(await getShipmentDetail(lab.admin, voidedId)).toBeNull();
    expect(await getShipmentDetail(lab.admin, 999_999)).toBeNull();
  });

  it("offers only units that can leave: in inventory, not held, matching the name", async () => {
    const found = async (q: string) =>
      (await searchShippableUnits(lab.admin, q)).map((u) => u.name);
    expect(await found("shippable")).toEqual(["Shippable A"]);
    expect(await found("held")).toEqual([]); // on hold
    expect(await found("%")).toEqual([]);
    expect(await found("")).toEqual([]);

    // Once shipped, it is no longer on offer.
    await updateShipment(lab.admin, made.draft!.id, { status: ShipmentStatus.IN_TRANSIT });
    expect(await found("shippable")).toEqual([]);
  });

  it("suggests a starting line from the unit", async () => {
    const [unit] = await searchShippableUnits(lab.admin, "shippable");
    expect(unit?.suggestion).toMatchObject({
      materialType: "PLANT",
      unitCount: 1,
      weightGrams: null,
    });
  });
});
