import { describe, expect, it } from "vitest";
import { layoutTree } from "./lineage-tree";

const node = (id: number, parentId: number | null) => ({ id, parentId, item: `U${id}` });

describe("layoutTree", () => {
  it("orders depth first and says where each branch goes", () => {
    // 1 ─┬─ 2 ─── 4
    //    └─ 3
    const rows = layoutTree([node(1, null), node(2, 1), node(3, 1), node(4, 2)]);
    expect(rows.map((r) => [r.id, r.depth, r.last, r.hasChildren])).toEqual([
      [1, 0, true, true],
      [2, 1, false, true],
      [4, 2, true, false],
      [3, 1, true, false],
    ]);
    // Unit 4 sits under 2, whose sibling 3 comes later: 2's branch line passes beside 4.
    expect(rows[2]?.through).toEqual([true]);
    expect(rows[3]?.through).toEqual([]);
  });

  it("treats a unit whose parent is not traced as a root", () => {
    const rows = layoutTree([node(5, 99), node(6, 5)]);
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      [5, 0],
      [6, 1],
    ]);
  });

  it("does not loop on a cycle", () => {
    expect(layoutTree([node(1, 2), node(2, 1)])).toHaveLength(0);
  });
});
