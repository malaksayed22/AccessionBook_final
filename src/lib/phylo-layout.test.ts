import { describe, expect, it } from "vitest";
import { cladeOf, layoutPhylo } from "./phylo-layout";

const node = (id: number, parentId: number | null) => ({ id, parentId, item: id });

describe("layoutPhylo", () => {
  it("makes every unit a tip, and a unit with offspring a fork whose first tip is itself", () => {
    // 1 has children 2 and 3; 2 has child 4.
    const layout = layoutPhylo([node(1, null), node(2, 1), node(3, 1), node(4, 2)]);
    // Tips top to bottom: 1, then 2's subtree (2, 4), then 3.
    expect(layout.tips.map((t) => [t.id, t.row])).toEqual([
      [1, 0],
      [2, 1],
      [4, 2],
      [3, 3],
    ]);
    const forks = Object.fromEntries(layout.forks.map((f) => [f.unitId, f]));
    expect(forks[2]).toMatchObject({ depth: 1, row: 1.5 });
    expect(forks[1]).toMatchObject({
      depth: 0,
      children: [
        { kind: "tip", id: 1 },
        { kind: "fork", id: 2 },
        { kind: "tip", id: 3 },
      ],
    });
    // The root fork sits between its first tip (row 0) and its last child (row 3).
    expect(forks[1]!.row).toBe(1.5);
    expect(layout.roots).toEqual([{ kind: "fork", id: 1 }]);
    expect(layout.depth).toBe(2);
  });

  it("finds a clade: a unit and everything derived from it", () => {
    const layout = layoutPhylo([node(1, null), node(2, 1), node(3, 1), node(4, 2)]);
    expect([...cladeOf(layout, 2)].sort()).toEqual([2, 4]);
    expect([...cladeOf(layout, 3)]).toEqual([3]);
  });

  it("draws a lone unit as one tip, and does not loop on a cycle", () => {
    expect(layoutPhylo([node(7, null)])).toMatchObject({ rows: 1, forks: [], depth: 1 });
    expect(layoutPhylo([node(1, 2), node(2, 1)]).tips).toHaveLength(0);
  });
});
