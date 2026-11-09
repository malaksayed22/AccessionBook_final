import { describe, expect, it, vi } from "vitest";

// The pure helpers under test never touch the database; keep the real client out of the import.
vi.mock("@/server/db", () => ({ prisma: {} }));

const { buildLocationHistory, buildMotherLineage, deriveMoves } = await import("./traceability");
type LocatedState = Parameters<typeof buildLocationHistory>[0][number];

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
const room = (id: number) => ({ id, name: `Room ${id}` });

function state(
  sequence: number,
  kind: string,
  roomId: number | null,
  effectiveDay: number,
  extra: Partial<LocatedState> = {}
): LocatedState {
  return {
    sequence,
    kind,
    effectiveAt: day(effectiveDay),
    scanConfirmed: false,
    comment: null,
    locationId: roomId,
    location: roomId === null ? null : room(roomId),
    recordedBy: { name: "Member" },
    ...extra,
  };
}

describe("deriveMoves", () => {
  it("takes the origin from the location carried by the previous event", () => {
    const moves = deriveMoves([
      state(1, "CREATED", 1, 0),
      state(2, "MEASURED", 1, 1),
      state(3, "MOVED", 2, 5),
      state(4, "MOVED", 3, 9),
    ]);
    expect(moves.map((m) => [m.fromLocation?.name, m.toLocation.name])).toEqual([
      ["Room 1", "Room 2"],
      ["Room 2", "Room 3"],
    ]);
  });

  it("reports an unlocated origin as null", () => {
    const [move] = deriveMoves([state(1, "CREATED", null, 0), state(2, "MOVED", 2, 3)]);
    expect(move?.fromLocation).toBeNull();
  });
});

describe("buildLocationHistory", () => {
  const now = day(30);

  it("builds one stay per room, with the open one current", () => {
    const history = buildLocationHistory(
      [
        state(1, "CREATED", 1, 0),
        state(2, "MOVED", 2, 10, { scanConfirmed: true, comment: "to flower room" }),
        state(3, "MEASURED", 2, 12),
      ],
      now
    );
    expect(history.stays.map((s) => [s.locationName, s.days, s.current])).toEqual([
      ["Room 1", 10, false],
      ["Room 2", 20, true],
    ]);
    expect(history.stays[1]).toMatchObject({
      movedBy: "Member",
      scanConfirmed: true,
      comment: "to flower room",
      to: null,
    });
    expect(history.stays[0]).toMatchObject({ movedBy: null, scanConfirmed: false });
    expect(history.current?.locationName).toBe("Room 2");
    expect(history.totalMoves).toBe(1);
    expect(history.distinctLocations).toBe(2);
  });

  it("counts a return to an earlier room as a new stay but one distinct location", () => {
    const history = buildLocationHistory(
      [state(1, "CREATED", 1, 0), state(2, "MOVED", 2, 5), state(3, "MOVED", 1, 9)],
      now
    );
    expect(history.stays).toHaveLength(3);
    expect(history.distinctLocations).toBe(2);
    expect(history.totalMoves).toBe(2);
  });

  it("stops the clock when the unit is destroyed or shipped", () => {
    const history = buildLocationHistory(
      [state(1, "CREATED", 1, 0), state(2, "MOVED", 2, 5), state(3, "DESTROYED", 2, 15)],
      now
    );
    const last = history.stays[1];
    expect(last).toMatchObject({ days: 10, current: true });
    expect(last?.to).toEqual(day(15));
  });

  it("skips events that do not change the room", () => {
    const history = buildLocationHistory(
      [state(1, "RECEIVED", 1, 0), state(2, "STAGE_CHANGED", 1, 3), state(3, "MEASURED", 1, 4)],
      now
    );
    expect(history.stays).toHaveLength(1);
    expect(history.totalMoves).toBe(0);
  });

  it("is empty for a unit that was never located", () => {
    const history = buildLocationHistory([state(1, "CREATED", null, 0)], now);
    expect(history).toEqual({ stays: [], current: null, distinctLocations: 0, totalMoves: 0 });
  });
});

describe("buildMotherLineage", () => {
  it("reads the mother, the parent and the generation from the ancestors, mother first", () => {
    const lineage = buildMotherLineage([
      { id: 1, name: "MOM", type: "PLANT" },
      { id: 2, name: "MOM-CL-1", type: "PLANT" },
    ]);
    expect(lineage.mother?.name).toBe("MOM");
    expect(lineage.parent?.name).toBe("MOM-CL-1");
    expect(lineage.generation).toBe(2);
  });

  it("gives a unit with no ancestors no mother and generation 0", () => {
    expect(buildMotherLineage([])).toEqual({
      parent: null,
      mother: null,
      ancestry: [],
      generation: 0,
    });
  });
});
