/** Pure helpers — safe to import from client components. */

/** Every experiment code starts with this: EXP1, EXP2, ... One scheme for the whole system. */
export const EXPERIMENT_CODE_PREFIX = "EXP";

const PREFIX_PATTERN = /^[A-Z]{2,4}$/;

/**
 * Fallback prefix when a user has never set their own: first + last initial,
 * or the first two letters when the account only carries a single name.
 */
export function deriveInitials(name: string): string {
  const digits = name.replace(/\D/g, "");
  const parts = name
    .replace(/[^A-Za-z\s'-]/g, " ")
    .split(/[\s'-]+/)
    .filter(Boolean);

  let letters: string;
  if (parts.length >= 2) {
    letters = (
      (parts[0] ?? "").charAt(0) + (parts[parts.length - 1] ?? "").charAt(0)
    ).toUpperCase();
  } else {
    const single = parts[0] ?? "";
    letters = (single.slice(0, 2) || "XX").toUpperCase().padEnd(2, "X");
  }

  // dummy1 / dummy2 would otherwise both become "DU" and share one code sequence.
  if (digits) {
    const n = Number(digits.slice(-2)) || 1;
    const extra = String.fromCharCode(64 + Math.min(26, Math.max(1, n)));
    return (letters + extra).slice(0, 4);
  }

  return letters;
}

export function normalizeCodePrefix(raw: string | null | undefined, fallbackName: string): string {
  const cleaned = (raw ?? "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 4);
  return PREFIX_PATTERN.test(cleaned) ? cleaned : deriveInitials(fallbackName);
}

export function isValidCodePrefix(raw: string): boolean {
  return PREFIX_PATTERN.test(raw.trim().toUpperCase());
}

/**
 * Highest `<PREFIX><n>` already taken. SQLite `LIKE` is case-insensitive for
 * ASCII, so this re-filters to codes that really belong to this prefix.
 */
export function highestCodeNumber(prefix: string, existingCodes: string[]): number {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let highest = 0;
  for (const code of existingCodes) {
    const match = pattern.exec(code);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

export function unitCodeFor(ecode: string, sequence: number): string {
  return `${ecode}-${String(sequence).padStart(3, "0")}`;
}

export function previewUnitCodes(ecode: string, total: number, sample = 3): string[] {
  const codes: string[] = [];
  for (let i = 1; i <= Math.min(total, sample); i++) codes.push(unitCodeFor(ecode, i));
  return codes;
}
