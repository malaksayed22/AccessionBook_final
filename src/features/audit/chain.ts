/**
 * Meaning of `audit_verify_chain()`'s answer. The database function returns English prose for the
 * first broken row; the screen needs a stable code to translate. Pure, so it can be tested.
 */
export type ChainFailureKind = "sequenceGap" | "linkBroken" | "contentAltered" | "unknown";

export function classifyChainFailure(reason: string): ChainFailureKind {
  if (/sequence gap|reorder/i.test(reason)) return "sequenceGap";
  if (/previous-hash|link broken/i.test(reason)) return "linkBroken";
  if (/does not match its hash|altered/i.test(reason)) return "contentAltered";
  return "unknown";
}
