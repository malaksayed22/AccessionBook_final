/**
 * Which events leave a unit with nothing in stock: destroyed, everything shipped, or (a plant group)
 * merged into another group. Every "in stock" filter uses these, so a new way of emptying a unit is
 * one edit here.
 */
export const NO_STOCK_KINDS = ["SHIPPED", "DESTROYED", "MERGED"] as const;

/** Nothing left without a destruction: everything shipped, or the group merged into another. */
export const EMPTIED_KINDS = ["SHIPPED", "MERGED"] as const;

export const isEmptied = (kind: string | null | undefined) =>
  kind === "SHIPPED" || kind === "MERGED";
