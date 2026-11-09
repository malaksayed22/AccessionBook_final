/** Largest value of an `Int` column; anything above it cannot be a record id. */
const MAX_RECORD_ID = 2_147_483_647;

/**
 * A record id from a URL segment or query parameter: a positive whole number that fits the database
 * column, otherwise undefined (so a hand-edited address is a 404 or ignored, never a database error).
 */
export function recordIdParam(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,10}$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 && n <= MAX_RECORD_ID ? n : undefined;
}
