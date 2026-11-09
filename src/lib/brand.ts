/**
 * Single source of truth for product identity.
 *
 * Every user-visible mention of the product name goes through here so a future
 * rename is one edit, not a repository-wide search. Previous names (CannaBase,
 * Tomerio) were scattered; keep them out of UI copy.
 *
 * Note on wording: the platform is deliberately domain-neutral. Cannabis
 * research is the first vertical, not the definition of the product, so copy
 * here says "sample" and "material" rather than "plant" or "cannabis".
 */

export const BRAND = {
  name: "Accession Book",
  /** Wordmark split so the second half can be tinted. */
  wordmark: { lead: "Accession", tail: " Book" },
  domain: "accessionbook.com",
  tagline: "Know every sample. Prove every gram.",
  /** One line under the wordmark in headers and sign-in. */
  subtitle: "Traceability & compliance platform",
  description:
    "Accession Book is the system of record for regulated material — lineage, custody, quality holds, recall and inspection-ready reporting, for any organisation that has to account for what it holds.",
  /** Namespace for browser storage keys. Keep lowercase. */
  storagePrefix: "accessionbook",
  /** Session cookie name. Changing this signs everyone out once. */
  sessionCookie: "accessionbook_session",
} as const;

/** Prefixed localStorage key, e.g. `accessionbook.experiment-intake-templates`. */
export function storageKey(name: string): string {
  return `${BRAND.storagePrefix}.${name}`;
}
