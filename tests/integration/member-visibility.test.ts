import { beforeEach, describe, expect, it } from "vitest";
import { MaterialClass, ShipmentDirection, ShipmentStatus } from "@/generated/prisma/enums";
import { lookup } from "@/features/search/queries";
import { createShipment } from "@/features/shipment/service";
import { getShipmentDetail, listShipments } from "@/features/shipment/queries";
import { listUnits } from "@/features/unit/queries";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

/**
 * A member sees only the experiments they belong to, and with them only those experiments' units,
 * shipments and search results. Administrators see the whole laboratory.
 */
describe("what a member can see", () => {
  let lab: Lab;
  let shipmentId: number;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    const unit = await registerOne(lab, { name: "SECRET-1" } as never);
    shipmentId = (
      await createShipment(lab.admin, {
        direction: ShipmentDirection.OUTBOUND,
        organizationId: lab.provider.id,
        status: ShipmentStatus.DRAFT,
        items: [
          {
            unitId: unit.id,
            description: "Plant",
            materialType: MaterialClass.PLANT,
            unitCount: 1,
          },
        ],
      } as Parameters<typeof createShipment>[1])
    ).id;
  });

  const listAll = (user: Lab["admin"]) =>
    listUnits(user, { page: 1, limit: 50, sort: "name", order: "asc" });
  const shipments = (user: Lab["admin"]) =>
    listShipments(user, { page: 1, limit: 50, sort: "date", order: "desc" } as never);

  it("lists the units of their own experiments, and none of others", async () => {
    expect((await listAll(lab.member)).total).toBe(1);
    expect((await listAll(lab.admin)).total).toBe(1);
    expect((await listAll(lab.outsider)).total).toBe(0);
  });

  it("finds neither the units nor the name of an experiment they are not on", async () => {
    const outsider = await lookup(lab.outsider, "Test experiment");
    expect(outsider.experiments).toEqual([]);
    expect((await lookup(lab.outsider, "SECRET")).units).toEqual([]);
    expect((await lookup(lab.member, "Test experiment")).experiments).toHaveLength(1);
  });

  it("sees only the shipments that carried a unit of their experiments", async () => {
    expect((await shipments(lab.admin)).total).toBe(1);
    expect((await shipments(lab.member)).total).toBe(1);
    expect((await shipments(lab.outsider)).total).toBe(0);
    expect(await getShipmentDetail(lab.outsider, shipmentId)).toBeNull();
    expect(await getShipmentDetail(lab.member, shipmentId)).not.toBeNull();
  });
});
