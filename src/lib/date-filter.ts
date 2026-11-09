/**
 * A calendar day from a URL parameter. URL text is untrusted: only a real `YYYY-MM-DD` day passes
 * (2026-02-31 does not), anything else is dropped so the page shows the unfiltered list instead of
 * failing. Pure, so it is unit tested.
 */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dayParam(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = DAY.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const real =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  return real ? value.trim() : undefined;
}

/** Puts a reversed range in order, so "from 5 May to 1 May" still finds something. */
export function orderedRange(
  from: string | undefined,
  to: string | undefined
): { from?: string; to?: string } {
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}
