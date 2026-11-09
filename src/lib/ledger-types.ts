/**
 * The unit's inventory ledger as data. Nothing here is a sentence: each event has a `type` and the
 * machine-readable facts the UI needs to write the sentence in the reader's language. Free text a
 * person typed (reason, comment, details) travels separately in `note` and is shown as recorded.
 */
export const LEDGER_EVENT_TYPES = [
  "REGISTERED",
  "RECEIVED",
  "DERIVED_FROM",
  "LINEAGE_LINKED",
  "PRODUCED",
  "MOVED",
  "STAGE_CHANGED",
  "SEX_CHANGED",
  "MEASURED",
  "SHIPPED",
  "SAMPLED",
  "WASTED",
  "REGROUPED",
  "MERGED",
  "DESTROYED",
  "HOLD_PLACED",
  "HOLD_RELEASED",
  "TEST",
  "INCIDENT",
  "ACTIVITY",
  "ATTACHMENT",
  "SHIPMENT",
  "AUDIT",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export type LedgerFacts = Record<string, string | number | boolean | null>;

export type LedgerEvent = {
  /** Stable key for lists. */
  key: string;
  type: LedgerEventType;
  /** When it happened (the effective date for unit events). ISO instant. */
  at: string;
  /** When it was filed, if that is a different moment from `at` (back-dated entries). ISO instant. */
  recordedAt: string | null;
  /** Who recorded it; null only for records that carry no author (such as an imported shipment line). */
  actor: string | null;
  /** The author's member id, when known, so the name can link to their page. */
  actorId?: number | null;
  /** Position in the unit's immutable event sequence, for the events that are unit states. */
  sequence: number | null;
  facts: LedgerFacts;
  /** Text written by a person, as recorded. */
  note: string | null;
  href?: string;
};
