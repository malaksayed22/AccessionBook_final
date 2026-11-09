import { beforeEach, describe, expect, it } from "vitest";
import { GrowthStage, UnitType } from "@/generated/prisma/enums";
import { getLocationOverview, listLocations } from "@/features/location/queries";
import { createLocation } from "@/features/location/service";
import { measureUnit, moveUnit } from "@/features/unit/service";
import { AppError } from "@/server/errors";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("rooms: a code each, and capacity in plants or grams", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("counts a room's capacity in plants", async () => {
    await createLocation(lab.admin, {
      name: "Flower Room A",
      code: "flw-a",
      capacity: 30,
      capacityMeasure: "PLANTS",
    });
    const room = (
      await listLocations(lab.admin, { sort: "name", order: "asc", page: 1, limit: 20 })
    ).rows.find((r) => r.name === "Flower Room A")!;
    // Codes are kept in capitals.
    expect(room.code).toBe("FLW-A");

    // A group of 25 plants fits; another group of 10 would make 35.
    await registerOne(lab, {
      name: "G-25",
      plantCount: 25,
      locationId: room.id,
      growthStage: GrowthStage.VEGETATIVE,
    } as never);
    const ten = await registerOne(lab, { name: "G-10", plantCount: 10 } as never);
    const refused = await failure(
      moveUnit(lab.member, ten.id, { toLocationId: room.id }, { requireScan: false })
    );
    expect(refused.code).toBe("CONFLICT");
    expect(refused.message).toContain("35 plants");
  });

  it("gives a new room the next R- code when none is named", async () => {
    await createLocation(lab.admin, { name: "Room R7", code: "R-007" });
    await createLocation(lab.admin, { name: "Room VEG", code: "VEG-40" });
    await createLocation(lab.admin, { name: "Room auto" });
    await createLocation(lab.admin, { name: "Room auto 2" });
    const rows = (
      await listLocations(lab.admin, { sort: "name", order: "asc", page: 1, limit: 50 })
    ).rows;
    const codeOf = (name: string) => rows.find((r) => r.name === name)?.code;
    expect(codeOf("Room auto")).toBe("R-008");
    expect(codeOf("Room auto 2")).toBe("R-009");
  });

  it("makes every location a room with its own code, made by managers only", async () => {
    await createLocation(lab.admin, { name: "Room B", code: "RB-1" });
    const taken = await failure(createLocation(lab.admin, { name: "Room C", code: "rb-1" }));
    expect(taken.details).toMatchObject({ reason: "locationCodeTaken" });
    // An inventory manager may add rooms; a member may not.
    const manager = { ...lab.member, permissions: "INVENTORY" as const };
    await createLocation(manager, { name: "Room D", code: "RD-1" });
    expect((await failure(createLocation(lab.member, { name: "Nope", code: "NO-1" }))).code).toBe(
      "FORBIDDEN"
    );
    const rows = (
      await listLocations(lab.admin, { sort: "name", order: "asc", page: 1, limit: 20 })
    ).rows;
    expect(rows.filter((r) => r.name.startsWith("Room")).every((r) => r.kind === "ROOM")).toBe(
      true
    );
  });

  it("counts a drying room's capacity in grams: dry weight once recorded, else wet", async () => {
    const room = await createLocation(lab.admin, {
      name: "Drying room",
      code: "DRY-9",
      capacity: 1_000,
      capacityMeasure: "WEIGHT",
    });
    // 600 g wet fits; a second lot of 500 g would make 1.1 kg.
    const first = await registerOne(lab, {
      name: "F-1",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.DRYING,
      humidWeight: 600,
      locationId: room.id,
    } as never);
    const second = await registerOne(lab, {
      name: "F-2",
      type: UnitType.FLOWER,
      growthStage: GrowthStage.DRYING,
      humidWeight: 500,
    } as never);
    const refused = await failure(
      moveUnit(lab.member, second.id, { toLocationId: room.id }, { requireScan: false })
    );
    expect(refused.code).toBe("CONFLICT");
    expect(refused.message).toContain("1.1 kg");

    // Once the first lot is dried to 150 g, the second fits; recording a weight is never refused.
    await measureUnit(lab.member, first.id, { dryWeight: 150 } as never);
    await moveUnit(lab.member, second.id, { toLocationId: room.id }, { requireScan: false });

    const rows = (
      await listLocations(lab.admin, { sort: "name", order: "asc", page: 1, limit: 20 })
    ).rows;
    expect(rows.find((r) => r.name === "Drying room")).toMatchObject({
      capacityMeasure: "WEIGHT",
      units: 2,
      grams: 650,
    });
    expect((await getLocationOverview(lab.admin)).atCapacity).toBe(0);
  });
});
