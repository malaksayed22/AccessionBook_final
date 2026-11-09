/**
 * Lays a lineage out as a rectangular tree (a cladogram): one row per unit, in depth-first order, each
 * row knowing how deep it is and which branch lines pass through it. Pure, so it is unit tested; the
 * drawing is `components/LineageTree.tsx`.
 */
export type TreeInput<T> = { id: number; parentId: number | null; item: T };

export type TreeRow<T> = {
  item: T;
  id: number;
  /** 0 for the root. */
  depth: number;
  /** The last child of its parent: its branch ends here. */
  last: boolean;
  /** Has children shown below it: a line leaves its node downwards. */
  hasChildren: boolean;
  /**
   * For each level above this row's own (0 … depth − 2 in tree terms, by the column of the ancestor
   * at that depth + 1): whether that ancestor's branch carries on below, so a line passes this row.
   */
  through: boolean[];
};

/**
 * Rows in depth-first order, children in the order they were given. A unit whose parent is not in the
 * list is a root; several roots stack one after the other.
 */
export function layoutTree<T>(nodes: readonly TreeInput<T>[]): TreeRow<T>[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<number | null, TreeInput<T>[]>();
  for (const node of nodes) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
  }

  const rows: TreeRow<T>[] = [];
  const seen = new Set<number>();
  const visit = (node: TreeInput<T>, depth: number, last: boolean, through: boolean[]) => {
    if (seen.has(node.id)) return; // a cycle in bad data must not loop forever
    seen.add(node.id);
    const kids = children.get(node.id) ?? [];
    rows.push({ item: node.item, id: node.id, depth, last, hasChildren: kids.length > 0, through });
    // Below this node, its own branch carries on past its children while it has later siblings.
    const next = depth === 0 ? [] : [...through, !last];
    kids.forEach((kid, index) => visit(kid, depth + 1, index === kids.length - 1, next));
  };
  const roots = children.get(null) ?? [];
  roots.forEach((root) => visit(root, 0, true, []));
  return rows;
}
