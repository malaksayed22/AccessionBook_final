/**
 * Lays a lineage out as a classic phylogenetic tree (a cladogram): every unit is a tip, all tips line
 * up on the right, and the branch points inside the tree are plain forks. A unit that others were
 * derived from becomes a fork whose first tip is the unit itself, followed by the subtrees of what
 * came from it (the way trees with sampled ancestors are drawn). Each fork sits one generation further
 * right than the fork it hangs from, level with the middle of its children. The same layout gives a
 * circular tree: a row becomes an angle and a generation a radius. Pure, so it is unit tested; the
 * drawing is `components/LineageTreeChart.tsx`.
 */
export type PhyloInput<T> = { id: number; parentId: number | null; item: T };

export type PhyloTip<T> = { id: number; item: T; row: number };

export type PhyloFork = {
  /** The unit whose descendants branch here. */
  unitId: number;
  /** Generation of that unit: 0 for the mother line's first unit. */
  depth: number;
  row: number;
  /** Children: tips (by unit id) and forks (by unit id), in drawing order. */
  children: Array<{ kind: "tip" | "fork"; id: number }>;
};

export type PhyloLayout<T> = {
  tips: PhyloTip<T>[];
  forks: PhyloFork[];
  /** The tree's top forks or lone tips (several when the lineage has several roots). */
  roots: Array<{ kind: "tip" | "fork"; id: number }>;
  /** How many tips (rows), at least 1. */
  rows: number;
  /** Generations of forks: tips line up one step past the deepest fork. */
  depth: number;
};

export function layoutPhylo<T>(input: readonly PhyloInput<T>[]): PhyloLayout<T> {
  const ids = new Set(input.map((n) => n.id));
  const byParent = new Map<number | null, PhyloInput<T>[]>();
  for (const node of input) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }

  const tips: PhyloTip<T>[] = [];
  const forks: PhyloFork[] = [];
  const seen = new Set<number>();
  let deepest = 0;

  /** Places a unit and what came from it; returns its row and what it is in the tree. */
  const place = (
    node: PhyloInput<T>,
    depth: number
  ): { kind: "tip" | "fork"; id: number; row: number } => {
    seen.add(node.id);
    const kids = (byParent.get(node.id) ?? []).filter((kid) => !seen.has(kid.id));
    if (kids.length === 0) {
      const tip = { id: node.id, item: node.item, row: tips.length };
      tips.push(tip);
      return { kind: "tip", id: node.id, row: tip.row };
    }
    deepest = Math.max(deepest, depth);
    // The unit itself is the fork's first tip, then the subtrees of what was derived from it.
    const self = { id: node.id, item: node.item, row: tips.length };
    tips.push(self);
    const placed = [
      { kind: "tip" as const, id: node.id, row: self.row },
      ...kids.map((kid) => place(kid, depth + 1)),
    ];
    const rows = placed.map((child) => child.row);
    const fork: PhyloFork = {
      unitId: node.id,
      depth,
      row: (Math.min(...rows) + Math.max(...rows)) / 2,
      children: placed.map(({ kind, id }) => ({ kind, id })),
    };
    forks.push(fork);
    return { kind: "fork", id: node.id, row: fork.row };
  };

  const roots = (byParent.get(null) ?? []).map((root) => {
    const placed = place(root, 0);
    return { kind: placed.kind, id: placed.id };
  });
  return {
    tips,
    forks,
    roots,
    rows: Math.max(tips.length, 1),
    depth: forks.length ? deepest + 1 : 1,
  };
}

/** The unit ids of a unit and everything derived from it: its clade. */
export function cladeOf<T>(layout: PhyloLayout<T>, unitId: number): Set<number> {
  const forkOf = new Map(layout.forks.map((f) => [f.unitId, f]));
  const out = new Set<number>();
  const walk = (id: number) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of forkOf.get(id)?.children ?? []) walk(child.id);
  };
  if (layout.tips.some((tip) => tip.id === unitId)) walk(unitId);
  return out;
}
