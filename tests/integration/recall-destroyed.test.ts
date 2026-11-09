import { beforeEach, describe, expect, it } from "vitest";
import {
  HoldKind,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
} from "@/generated/prisma/enums";
import { getRecallTrace, listDestroyedUnits, searchRecallUnits } from "@/features/qa/queries";
import type { DestroyedListParams } from "@/features/qa/queries";
import { placeHold } from "@/features/qa/service";
import { createShipment } from "@/features/shipment/service";
import { deriveUnits, destroyUnit } from "@/features/unit/service";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

process.env.LAB_TIMEZONE = "America/Toronto";

describe("recall trace", () => {
  let lab: Lab;
  let ids: Record<string, number>;
  let shipmentId: number;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    const mom = await registerOne(lab, { name: "MOM" });
    const batch = await deriveUnits(lab.member, mom.id, { deriveType: "clone", quantity: 2 });
    ids = { MOM: mom.id };
    for (const unit of batch.units) ids[unit.name] = unit.id;
    const grand = await deriveUnits(lab.member, ids["MOM-CL-1"]!, {
      deriveType: "cutting",
      quantity: 1,
    });
    ids.GRAND = grand.units[0]!.id;

    // The first clone left for the supplier; the second is held; the grandchild is untouched.
    shipmentId = (
      await createShipment(lab.admin, {
        direction: ShipmentDirection.OUTBOUND,
        organizationId: lab.provider.id,
        status: ShipmentStatus.IN_TRANSIT,
        items: [
          {
            unitId: ids["MOM-CL-1"],
            description: "Clone",
            materialType: MaterialClass.CLONE,
            unitCount: 1,
          },
        ],
      } as Parameters<typeof createShipment>[1])
    ).id;
    await placeHold(lab.member, ids["MOM-CL-2"]!, {
      reason: "Suspected mites",
      kind: HoldKind.HOLD,
    });
  });

  it("follows the lineage depth first and says where each unit is", async () => {
    const trace = await getRecallTrace(lab.admin, ids.MOM!);
    if (!trace) throw new Error("no trace");
    expect(
      trace.downstream.map((n) => [n.name, n.generation, n.parentId === ids.MOM ? "mom" : "child"])
    ).toEqual([
      ["MOM-CL-1", 1, "mom"],
      ["MOM-CL-1-CL-1", 2, "child"],
      ["MOM-CL-2", 1, "mom"],
    ]);
    const byName = Object.fromEntries(trace.downstream.map((n) => [n.name, n]));
    expect(byName["MOM-CL-1"]).toMatchObject({
      standing: "active",
      nothingLeft: true,
      locationName: null,
      shippedTo: [expect.objectContaining({ name: "Seed Supplier Inc." })],
      shipmentIds: [shipmentId],
    });
    expect(byName["MOM-CL-2"]).toMatchObject({ standing: "on-hold", locationName: "Room 1" });
    expect(byName["MOM-CL-2"]?.hold).toMatchObject({ reason: "Suspected mites", origin: "MANUAL" });
    expect(trace.truncated).toBe(false);
  });

  it("counts statuses, shipments and the organizations that received units", async () => {
    const trace = await getRecallTrace(lab.admin, ids.MOM!);
    expect(trace?.counts).toMatchObject({
      upstream: 0,
      downstream: 3,
      inInventory: 3,
      onHold: 1,
      shipped: 1,
      destroyed: 0,
      shipments: 1,
      organizations: 1,
    });
    expect(trace?.organizations).toEqual([
      expect.objectContaining({
        name: "Seed Supplier Inc.",
        unitCount: 1,
        shipmentIds: [shipmentId],
      }),
    ]);
    expect(trace?.shipments[0]).toMatchObject({ id: shipmentId, unitNames: ["MOM-CL-1"] });
  });

  it("finds shipments of units upstream and downstream of the traced unit", async () => {
    const fromGrandchild = await getRecallTrace(lab.admin, ids.GRAND!);
    expect(fromGrandchild?.upstream.map((n) => [n.name, n.generation])).toEqual([
      ["MOM", -2],
      ["MOM-CL-1", -1],
    ]);
    // The parent that shipped is two steps up from the grandchild, and still shows its shipment.
    expect(fromGrandchild?.shipments.map((s) => s.id)).toEqual([shipmentId]);
    expect(fromGrandchild?.counts.shipped).toBe(1);
  });

  it("ignores cancelled shipments and voided ones", async () => {
    const draft = await createShipment(lab.admin, {
      direction: ShipmentDirection.OUTBOUND,
      organizationId: lab.provider.id,
      items: [
        {
          unitId: ids.GRAND,
          description: "Cutting",
          materialType: MaterialClass.PLANT,
          unitCount: 1,
        },
      ],
    } as Parameters<typeof createShipment>[1]);
    const { updateShipment } = await import("@/features/shipment/service");
    await updateShipment(lab.admin, draft.id, { status: ShipmentStatus.CANCELLED });
    const trace = await getRecallTrace(lab.admin, ids.MOM!);
    expect(trace?.shipments.map((s) => s.id)).toEqual([shipmentId]);
  });

  it("returns null for an unknown unit", async () => {
    expect(await getRecallTrace(lab.admin, 999_999)).toBeNull();
  });

  it("finds units by part of the name or by number, exact matches first", async () => {
    const names = async (q: string) => (await searchRecallUnits(lab.admin, q)).map((u) => u.name);
    expect(await names("mom-cl")).toEqual(["MOM-CL-1", "MOM-CL-1-CL-1", "MOM-CL-2"]);
    expect((await names("MOM"))[0]).toBe("MOM");
    expect(await names(String(ids.GRAND))).toContain("MOM-CL-1-CL-1");
    expect(await names("%")).toEqual([]);
    expect(await names("   ")).toEqual([]);
  });
});

const base: DestroyedListParams = { sort: "name", order: "asc", page: 1, limit: 10 };

describe("destruction register", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    const make = async (name: string, effectiveAt: string, reason: string, over = {}) => {
      const unit = await registerOne(lab, { name, effectiveAt: "2026-01-01", ...over });
      await destroyUnit(lab.admin, unit.id, {
        reason,
        effectiveAt,
      } as Parameters<typeof destroyUnit>[2]);
    };
    await make("Zulu", "2026-02-10", "Failed germination test");
    await make("Echo", "2026-03-15", "Mould found at inspection, 100% lost");
    await make("Kilo", "2026-03-20", "Mites", { type: "SEEDLOT", sourceType: "INTERNAL" });
    await registerOne(lab, { name: "Alive" });
  });

  const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

  it("lists only destroyed units, with who recorded them", async () => {
    const { rows, total } = await listDestroyedUnits(lab.admin, base);
    expect(total).toBe(3);
    expect(names(rows)).toEqual(["Echo", "Kilo", "Zulu"]);
    expect(rows[2]).toMatchObject({
      reason: "Failed germination test",
      actor: "Admin",
      locationName: "Room 1",
      cultivarName: "Northern Lights",
      experiment: { ecode: "AB1" },
    });
    expect(rows[2]?.destroyedAt.toISOString().slice(0, 10)).toBe("2026-02-10");
  });

  it("filters by date range (lab days, both ends included) and type", async () => {
    const inRange = async (from?: string, to?: string) =>
      names((await listDestroyedUnits(lab.admin, { ...base, from, to })).rows);
    expect(await inRange("2026-03-15", "2026-03-15")).toEqual(["Echo"]);
    expect(await inRange("2026-03-01", "2026-03-31")).toEqual(["Echo", "Kilo"]);
    expect(await inRange(undefined, "2026-02-28")).toEqual(["Zulu"]);
    expect(await inRange("2026-04-01")).toEqual([]);
    expect(names((await listDestroyedUnits(lab.admin, { ...base, type: "SEEDLOT" })).rows)).toEqual(
      ["Kilo"]
    );
  });

  it("searches name, reason and people, treating the text literally", async () => {
    const find = async (q: string) =>
      names((await listDestroyedUnits(lab.admin, { ...base, q })).rows);
    expect(await find("mould")).toEqual(["Echo"]);
    expect(await find("admin")).toEqual(["Echo", "Kilo", "Zulu"]);
    expect(await find("zul")).toEqual(["Zulu"]);
    expect(await find("100%")).toEqual(["Echo"]);
    expect(await find("%")).toEqual(["Echo"]);
    expect(await find("%%")).toEqual([]);
    expect(await find(`'; DROP TABLE "UnitState"; --`)).toEqual([]);
  });

  it("sorts by date and pages without repeating rows", async () => {
    const newest = await listDestroyedUnits(lab.admin, { ...base, sort: "date", order: "desc" });
    expect(names(newest.rows)).toEqual(["Kilo", "Echo", "Zulu"]);
    const first = await listDestroyedUnits(lab.admin, { ...base, limit: 2 });
    const second = await listDestroyedUnits(lab.admin, { ...base, limit: 2, page: 2 });
    expect([...names(first.rows), ...names(second.rows)]).toEqual(["Echo", "Kilo", "Zulu"]);
    expect(first.total).toBe(3);
    expect(names((await listDestroyedUnits(lab.admin, { ...base, sort: "type" })).rows)[2]).toBe(
      "Kilo"
    );
  });
});
