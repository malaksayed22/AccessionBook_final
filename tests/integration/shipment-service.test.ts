import { beforeEach, describe, expect, it } from "vitest";
import {
  GrowthStage,
  HoldKind,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
  UnitStateKind,
  UnitType,
} from "@/generated/prisma/enums";
import { getUnitLedger, getUnitProfile } from "@/features/unit/queries";
import { getUnitStatusCounts, listUnits } from "@/features/unit/queries";
import { createShipment, updateShipment, voidShipment } from "@/features/shipment/service";
import { listAllShipments } from "@/features/shipment/queries";
import { placeHold } from "@/features/qa/service";
import { moveUnit } from "@/features/unit/service";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase, statesOf, verifyChain } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const line = (unitId: number | undefined, over: Record<string, unknown> = {}) => ({
  unitId,
  description: "Plant shipment line",
  materialType: MaterialClass.PLANT,
  unitCount: 1,
  ...over,
});

/** A free line: trim leaves without being a unit (it is not tracked as one). */
const trimLine = () =>
  line(undefined, {
    description: "Bulk trim",
    materialType: MaterialClass.TRIM,
    weightGrams: 5,
    moisture: "WET",
    unitCount: undefined,
  });

describe("shipment service", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  const outbound = (items: ReturnType<typeof line>[], over: Record<string, unknown> = {}) =>
    createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: lab.provider.id,
      items,
      ...over,
    } as Parameters<typeof createShipment>[1]);

  it("keeps a draft free of inventory effects until it leaves", async () => {
    const unit = await registerOne(lab);
    const draft = await outbound([line(unit.id)]);
    expect(draft.status).toBe(ShipmentStatus.DRAFT);
    expect(await statesOf(unit.id)).toHaveLength(1);

    await updateShipment(lab.admin, draft.id, { status: ShipmentStatus.IN_TRANSIT });
    const states = await statesOf(unit.id);
    expect(states.map((s) => s.kind)).toEqual([UnitStateKind.CREATED, UnitStateKind.SHIPPED]);
    expect(states[1]).toMatchObject({
      organizationId: lab.provider.id,
      locationId: lab.rooms[0].id,
    });

    const item = await prisma.shipmentItem.findFirstOrThrow({ where: { shipmentId: draft.id } });
    expect(item.stateId).toBe(states[1]?.id);
    // The unit has left inventory: nothing more can happen to it.
    await expectCode(
      moveUnit(lab.member, unit.id, { toLocationId: lab.rooms[1].id }, { requireScan: false }),
      "UNIT_NOT_ACTIVE"
    );
  });

  it("applies inventory events when created already in transit", async () => {
    const unit = await registerOne(lab);
    await outbound([line(unit.id)], { status: ShipmentStatus.IN_TRANSIT });
    expect((await statesOf(unit.id)).at(-1)?.kind).toBe(UnitStateKind.SHIPPED);
  });

  describe("shipping part of a unit", () => {
    const flowerLine = (unitId: number, grams: number, moisture: "WET" | "DRY") =>
      line(unitId, {
        description: "Flower",
        materialType: MaterialClass.FLOWER,
        weightGrams: grams,
        moisture,
        unitCount: undefined,
      });
    /** Fresh flower: weighed wet only, so it ships by wet weight. */
    const flower = () =>
      registerOne(lab, {
        name: "FLOWER-1",
        type: UnitType.FLOWER,
        growthStage: GrowthStage.HARVESTED,
        humidWeight: 100,
      } as never);
    /** Dried flower: a dry weight is recorded, so it ships by dry weight. */
    const driedFlower = () =>
      registerOne(lab, {
        name: "DRIED-1",
        type: UnitType.FLOWER,
        growthStage: GrowthStage.CURING,
        humidWeight: 100,
        dryWeight: 25,
      } as never);

    it("takes part of a flower, keeps it active, and records what was left", async () => {
      const unit = await flower();
      await outbound([flowerLine(unit.id, 30, "WET")], { status: ShipmentStatus.IN_TRANSIT });
      const states = await statesOf(unit.id);
      expect(states.map((s) => s.kind)).toEqual([
        UnitStateKind.CREATED,
        UnitStateKind.SHIPPED_PART,
      ]);
      expect(states[1]).toMatchObject({
        shippedMoisture: "WET",
        organizationId: lab.provider.id,
      });
      expect(Number(states[1]?.shippedWeight)).toBe(30);
      expect(Number(states[1]?.humidWeight)).toBe(70);
      expect(states[1]?.dryWeight).toBeNull(); // never weighed dry: still unrecorded

      // Not a status: the unit is still active and can be changed, moved or shipped again.
      const profile = await getUnitProfile(lab.admin, unit.id);
      expect(profile?.status).toBe("active");
      expect(profile?.terminal).toBeNull();
      await moveUnit(
        lab.member,
        unit.id,
        { toLocationId: lab.rooms[1].id },
        { requireScan: false }
      );
      await outbound([flowerLine(unit.id, 20, "WET")], { status: ShipmentStatus.IN_TRANSIT });
      expect(
        (await statesOf(unit.id)).filter((s) => s.kind === UnitStateKind.SHIPPED_PART)
      ).toHaveLength(2);
    });

    it("shows each shipment in the unit's history with the original and what is left", async () => {
      const unit = await flower();
      await outbound([flowerLine(unit.id, 30, "WET")], { status: ShipmentStatus.IN_TRANSIT });
      await outbound([flowerLine(unit.id, 25.5, "WET")], { status: ShipmentStatus.IN_TRANSIT });

      const shipped = (await getUnitLedger(lab.admin, unit.id)).filter((e) => e.type === "SHIPPED");
      expect(shipped).toHaveLength(2);
      const [latest, first] = shipped;
      expect(first?.facts).toMatchObject({
        measure: "weight",
        basis: "WET",
        original: 100,
        shipped: 30,
        totalShipped: 30,
        remaining: 70,
        final: false,
      });
      expect(latest?.facts).toMatchObject({
        original: 100,
        shipped: 25.5,
        totalShipped: 55.5,
        remaining: 44.5,
        final: false,
      });
      expect(latest?.href).toMatch(/^\/inventory\/materials\/\d+$/);

      const profile = await getUnitProfile(lab.admin, unit.id);
      expect(profile?.shipping).toMatchObject({
        shipments: 2,
        nothingLeft: false,
        wet: { original: 100, shipped: 55.5, left: 44.5 },
      });
    });

    it("ships dried flower by dry weight only", async () => {
      const unit = await driedFlower();
      const wet = await outbound([flowerLine(unit.id, 10, "WET")]);
      await expectCode(
        updateShipment(lab.admin, wet.id, { status: ShipmentStatus.IN_TRANSIT }),
        "VALIDATION"
      );
      await outbound([flowerLine(unit.id, 10, "DRY")], { status: ShipmentStatus.IN_TRANSIT });
      const last = (await statesOf(unit.id)).at(-1);
      expect(last?.kind).toBe(UnitStateKind.SHIPPED_PART);
      expect(Number(last?.dryWeight)).toBe(15);
      expect(Number(last?.humidWeight)).toBe(100); // the other basis is untouched
    });

    it("refuses to ship more than is left, and a flower line without a basis", async () => {
      const unit = await flower();
      await outbound([flowerLine(unit.id, 90, "WET")], { status: ShipmentStatus.IN_TRANSIT });
      const tooMuch = await outbound([flowerLine(unit.id, 11, "WET")]);
      await expectCode(
        updateShipment(lab.admin, tooMuch.id, { status: ShipmentStatus.IN_TRANSIT }),
        "VALIDATION"
      );
      // Nothing was taken by the refused shipment.
      expect(await statesOf(unit.id)).toHaveLength(2);
      expect(await verifyChain()).toEqual([]);
    });

    it("keeps the unit active with nothing left once everything has shipped", async () => {
      const unit = await driedFlower();
      await outbound([flowerLine(unit.id, 15, "DRY")], { status: ShipmentStatus.IN_TRANSIT });
      await outbound([flowerLine(unit.id, 10, "DRY")], { status: ShipmentStatus.IN_TRANSIT });
      const last = (await statesOf(unit.id)).at(-1);
      expect(last?.kind).toBe(UnitStateKind.SHIPPED);
      expect(Number(last?.humidWeight)).toBe(0);
      expect(Number(last?.dryWeight)).toBe(0);

      const profile = await getUnitProfile(lab.admin, unit.id);
      expect(profile?.status).toBe("active");
      expect(profile?.shipping).toMatchObject({ nothingLeft: true });
      // Still active on record, but it is listed and counted under "nothing left", never as stock.
      const listed = await listUnits(lab.admin, {
        page: 1,
        limit: 50,
        sort: "name",
        order: "asc",
        status: "empty",
      } as never);
      expect(listed.rows.find((r) => r.id === unit.id)).toMatchObject({
        status: "active",
        nothingLeft: true,
      });
      const active = await listUnits(lab.admin, {
        page: 1,
        limit: 50,
        sort: "name",
        order: "asc",
        status: "active",
      } as never);
      expect(active.rows.find((r) => r.id === unit.id)).toBeUndefined();
      expect((await getUnitStatusCounts(lab.admin, {})).empty).toBeGreaterThanOrEqual(1);
      // Nothing can be done with it any more.
      await expectCode(
        moveUnit(lab.member, unit.id, { toLocationId: lab.rooms[1].id }, { requireScan: false }),
        "UNIT_NOT_ACTIVE"
      );
    });

    it("ships a seed lot by count", async () => {
      const lot = await registerOne(lab, {
        name: "SEEDS-1",
        type: UnitType.SEEDLOT,
        seedCount: 50,
        growthStage: undefined,
      } as never);
      const seedLine = (count: number) =>
        line(lot.id, { description: "Seeds", materialType: MaterialClass.SEED, unitCount: count });
      await outbound([seedLine(30)], { status: ShipmentStatus.IN_TRANSIT });
      let states = await statesOf(lot.id);
      expect(states.at(-1)).toMatchObject({
        kind: UnitStateKind.SHIPPED_PART,
        shippedCount: 30,
        seedCount: 20,
      });

      const tooMany = await outbound([seedLine(21)]);
      await expectCode(
        updateShipment(lab.admin, tooMany.id, { status: ShipmentStatus.IN_TRANSIT }),
        "VALIDATION"
      );

      await outbound([seedLine(20)], { status: ShipmentStatus.IN_TRANSIT });
      states = await statesOf(lot.id);
      expect(states.at(-1)).toMatchObject({
        kind: UnitStateKind.SHIPPED,
        shippedCount: 20,
        seedCount: 0,
      });
    });
  });

  it("is all or nothing: one unit on hold stops the whole shipment", async () => {
    const free = await registerOne(lab, { name: "FREE" });
    const held = await registerOne(lab, { name: "HELD" });
    await placeHold(lab.member, held.id, { reason: "Failed potency", kind: HoldKind.HOLD });

    const draft = await outbound([line(free.id), line(held.id)]);
    await expectCode(
      updateShipment(lab.admin, draft.id, { status: ShipmentStatus.IN_TRANSIT }),
      "UNIT_ON_HOLD"
    );
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      ShipmentStatus.DRAFT
    );
    expect(await statesOf(free.id)).toHaveLength(1);
    expect(await verifyChain()).toEqual([]);
  });

  it("refuses the same unit twice and units that already left", async () => {
    const unit = await registerOne(lab);
    const twice = await outbound([line(unit.id), line(unit.id)]);
    await expectCode(
      updateShipment(lab.admin, twice.id, { status: ShipmentStatus.IN_TRANSIT }),
      "CONFLICT"
    );

    await outbound([line(unit.id)], { status: ShipmentStatus.IN_TRANSIT });
    const again = await outbound([line(unit.id)]);
    await expectCode(
      updateShipment(lab.admin, again.id, { status: ShipmentStatus.IN_TRANSIT }),
      "UNIT_NOT_ACTIVE"
    );
  });

  it("only moves forward through its statuses", async () => {
    const draft = await outbound([trimLine()]);
    await updateShipment(lab.admin, draft.id, { status: ShipmentStatus.IN_TRANSIT });
    await expectCode(
      updateShipment(lab.admin, draft.id, { status: ShipmentStatus.CANCELLED }),
      "CONFLICT"
    );
    await updateShipment(lab.admin, draft.id, { status: ShipmentStatus.DELIVERED });
    await expectCode(
      updateShipment(lab.admin, draft.id, { status: ShipmentStatus.DRAFT }),
      "CONFLICT"
    );
    const delivered = await prisma.shipment.findUniqueOrThrow({ where: { id: draft.id } });
    expect(delivered.deliveredDate).toBeInstanceOf(Date); // never an open-ended custody chain
  });

  it("is admin-only", async () => {
    await expectCode(
      createShipment(lab.member, {
        direction: ShipmentDirection.OUTBOUND,
        organizationId: lab.provider.id,
        items: [line(undefined)],
      } as Parameters<typeof createShipment>[1]),
      "FORBIDDEN"
    );
    const draft = await outbound([trimLine()]);
    await expectCode(updateShipment(lab.member, draft.id, { comment: "tampering" }), "FORBIDDEN");
  });

  it("books each line in its regulatory basis and rejects mismatches", async () => {
    await expectCode(
      outbound([
        { description: "Flower", materialType: MaterialClass.FLOWER, weightGrams: 10 } as never,
      ]),
      "VALIDATION"
    ); // weight needs a wet/dry basis
    await expectCode(
      outbound([
        { description: "Seeds", materialType: MaterialClass.SEED, unitCount: 1.5 } as never,
      ]),
      "VALIDATION"
    ); // counts are whole numbers
    const ok = await outbound([
      {
        description: "Trim",
        materialType: MaterialClass.TRIM,
        weightGrams: 10.25,
        moisture: "DRY",
      } as never,
    ]);
    const [shipment] = await listAllShipments();
    expect(shipment?.id).toBe(ok.id);
    expect(shipment?.items[0]).toMatchObject({ weightGrams: 10.25, unitCount: null });
    expect(typeof shipment?.items[0]?.weightGrams).toBe("number"); // never a Decimal object
  });

  it("takes every shipped line from inventory, except trim", async () => {
    const error = await outbound([
      line(undefined, { description: "Loose plants", materialType: MaterialClass.PLANT }),
    ]).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "VALIDATION", details: { reason: "outboundNeedsUnit" } });
    expect((await outbound([trimLine()])).status).toBe(ShipmentStatus.DRAFT);
  });

  it("leaves a basis that was never weighed unrecorded when everything ships", async () => {
    const unit = await registerOne(lab, {
      name: "WET-ONLY",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.HARVESTED,
      humidWeight: 40,
    } as never);
    await outbound(
      [
        line(unit.id, {
          description: "Flower",
          materialType: MaterialClass.FLOWER,
          weightGrams: 40,
          moisture: "WET",
          unitCount: undefined,
        }),
      ],
      { status: ShipmentStatus.IN_TRANSIT }
    );
    const last = (await statesOf(unit.id)).at(-1);
    expect(last?.kind).toBe(UnitStateKind.SHIPPED);
    expect(Number(last?.humidWeight)).toBe(0);
    expect(last?.dryWeight).toBeNull();
  });

  it("does not let received lines reference units", async () => {
    const unit = await registerOne(lab);
    await expectCode(
      createShipment(lab.admin, {
        direction: ShipmentDirection.INBOUND,
        organizationId: lab.provider.id,
        items: [line(unit.id)],
      } as Parameters<typeof createShipment>[1]),
      "VALIDATION"
    );
  });

  it("audits every field that changes, including custody details", async () => {
    const draft = await outbound([trimLine()]);
    await updateShipment(lab.admin, draft.id, {
      trackingNumber: "TRK-1",
      licenceNumber: "LIC-77",
    });
    const entry = (await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 }))[0];
    const fields = (entry?.details as Array<{ field: string }>).map((c) => c.field).sort();
    expect(fields).toEqual(["licenceNumber", "trackingNumber"]);
    expect((await updateShipment(lab.admin, draft.id, { trackingNumber: "TRK-1" })).unchanged).toBe(
      true
    );
  });

  it("voids only shipments that never left, keeping the record", async () => {
    const draft = await outbound([trimLine()]);
    await voidShipment(lab.admin, draft.id, { reason: "Created in error" });
    expect(await listAllShipments()).toHaveLength(0);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: draft.id } })).voidReason).toBe(
      "Created in error"
    );

    const sent = await outbound([trimLine()], { status: ShipmentStatus.IN_TRANSIT });
    await expectCode(voidShipment(lab.admin, sent.id, { reason: "Changed my mind" }), "CONFLICT");
  });
});
