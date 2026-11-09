import { isEmptied } from "@/lib/stock-kinds";

/**
 * Where a unit stands, from its newest event and its active hold. One definition for every list
 * that shows it. A unit has three statuses: active, on hold, destroyed. Shipping is not a status:
 * a unit that has shipped in part is active with less left, and one that has shipped everything stays
 * active with nothing left (see `hasNothingLeft`). Pure, so it is unit tested.
 */
export type UnitStanding = "active" | "on-hold" | "destroyed";

export function unitStanding(
  stateKind: string | null | undefined,
  holdKind: string | null | undefined
): UnitStanding {
  if (stateKind === "DESTROYED") return "destroyed";
  if (holdKind) return "on-hold";
  return "active";
}

/**
 * True once nothing is left without a destruction: a shipment took everything, or the plant group
 * merged into another. The unit stays on record, with nothing in stock.
 */
export function hasNothingLeft(stateKind: string | null | undefined): boolean {
  return isEmptied(stateKind);
}
