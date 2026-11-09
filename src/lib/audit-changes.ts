/** One field-level change recorded in an audit entry. */
export type AuditChange = { field: string; from?: string | null; to?: string | null };

/**
 * Audit `details` is stored as JSON. Entries written before the PostgreSQL move held a
 * JSON *string*, so both shapes are accepted; anything unrecognised yields no changes.
 */
export function parseAuditChanges(details: unknown): AuditChange[] {
  let value = details;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AuditChange[] => {
    if (typeof item !== "object" || item === null) return [];
    const { field, from, to } = item as Record<string, unknown>;
    if (typeof field !== "string") return [];
    return [
      {
        field,
        from: from == null ? null : String(from),
        to: to == null ? null : String(to),
      },
    ];
  });
}

/** `field: from → to; field: from → to` — used by the activity page and exports. */
export function formatAuditChanges(details: unknown, empty = "—"): string {
  const changes = parseAuditChanges(details);
  if (changes.length === 0) return empty;
  return changes.map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join("; ");
}
