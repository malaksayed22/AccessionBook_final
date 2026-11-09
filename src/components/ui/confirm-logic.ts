/** Rules for when ConfirmDialog's confirm button may be pressed. Pure, so they are unit tested. */
export type ConfirmRules = {
  /** Reason text typed so far. */
  reason: string;
  /** Minimum trimmed length of the reason when one is required. */
  reasonMinLength?: number;
  requireReason: boolean;
  /** Phrase the user must type exactly; empty or undefined means none is required. */
  phrase?: string;
  typed: string;
  pending: boolean;
};

export const DEFAULT_REASON_MIN_LENGTH = 10;

export function reasonIsValid(reason: string, requireReason: boolean, minLength: number): boolean {
  return !requireReason || reason.trim().length >= minLength;
}

export function phraseMatches(typed: string, phrase: string | undefined): boolean {
  return !phrase || typed.trim() === phrase;
}

export function canConfirm(rules: ConfirmRules): boolean {
  if (rules.pending) return false;
  const minLength = rules.reasonMinLength ?? DEFAULT_REASON_MIN_LENGTH;
  return (
    reasonIsValid(rules.reason, rules.requireReason, minLength) &&
    phraseMatches(rules.typed, rules.phrase)
  );
}
