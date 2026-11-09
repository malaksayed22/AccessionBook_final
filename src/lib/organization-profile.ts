import type { LicenceClass } from "@/generated/prisma/enums";
import { emptyTotals, sumMaterials, type MaterialTotals, type QuantityInput } from "./materials";

/**
 * Pure rules behind the organization pages. The database is read in
 * `features/organization/queries.ts`; nothing here touches it, and nothing here holds text: the
 * pages translate the keys.
 */

/**
 * The Health Canada licence classes an organization can hold, in the order the form offers them. A
 * Canadian recipient's class decides the CTLS line its shipments go on.
 */
export const LICENCE_CLASSES = [
  "CULTIVATION",
  "PROCESSING",
  "ANALYTICAL_TESTING",
  "RESEARCH",
  "MEDICAL_SALES",
] as const satisfies readonly LicenceClass[];
export type LicenceClassId = (typeof LICENCE_CLASSES)[number];

/** What an organization is to us, told from the records that mention it (there is no stored type). */
export const ORGANIZATION_RELATIONS = ["supplier", "recipient", "lab"] as const;
export type OrganizationRelation = (typeof ORGANIZATION_RELATIONS)[number];

export type RelationEvidence = {
  /** Units registered with this organization as their provider. */
  suppliedUnits: number;
  /** Inbound shipments (material received from it). */
  inboundShipments: number;
  /** Outbound shipments (material sent to it). */
  outboundShipments: number;
  /** Lab results whose lab name is this organization's name. */
  labResults: number;
};

export function relationsOf(evidence: RelationEvidence): OrganizationRelation[] {
  const relations: OrganizationRelation[] = [];
  if (evidence.suppliedUnits > 0 || evidence.inboundShipments > 0) relations.push("supplier");
  if (evidence.outboundShipments > 0) relations.push("recipient");
  if (evidence.labResults > 0) relations.push("lab");
  return relations;
}

/** One group of shipment lines as the database aggregates them. */
export type MaterialGroup = QuantityInput;

/** Totals the CTLS way: counts per material, grams per wet/dry basis. */
export function totalsFromGroups(groups: MaterialGroup[]): MaterialTotals {
  return groups.length === 0 ? emptyTotals() : sumMaterials(groups);
}

export const TOTAL_KEYS = [
  "seeds",
  "clones",
  "plants",
  "cultures",
  "wetGrams",
  "dryGrams",
] as const satisfies ReadonlyArray<keyof MaterialTotals>;
export type TotalKey = (typeof TOTAL_KEYS)[number];

/** Only the totals that are not zero, in a fixed order, for display. */
export function nonZeroTotals(totals: MaterialTotals): Array<{ key: TotalKey; value: number }> {
  return TOTAL_KEYS.flatMap((key) => (totals[key] > 0 ? [{ key, value: totals[key] }] : []));
}
