/**
 * How a member arranges a list: which columns it shows and what it groups by. Both live in the
 * page's URL (`hide=cultivar,location`, `group=location`), with its filters and sort, so a view can
 * be bookmarked, shared as a link or saved under a name.
 */

export const HIDE_PARAM = "hide";
export const GROUP_PARAM = "group";

/** The lists whose views a member can save. */
export const VIEW_LISTS = ["units", "experiments", "shipments"] as const;
export type ViewList = (typeof VIEW_LISTS)[number];

/** The longest query a saved view keeps. */
export const MAX_VIEW_QUERY = 1000;

/** The columns named in `hide` that the list lets a member hide, each once. */
export function hiddenColumns(raw: string | undefined, optional: readonly string[]): string[] {
  if (!raw) return [];
  const allowed = new Set(optional);
  return [...new Set(raw.split(",").map((id) => id.trim()))].filter((id) => allowed.has(id));
}

/** `hidden` with the column shown again, or hidden when it was shown. */
export function toggleColumn(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
}

/**
 * A view's query string as it is saved: parameters in a stable order, without the page number (a
 * view opens on its first page) and without empty values.
 */
export function normalizeViewQuery(query: string): string {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const kept = [...params.entries()]
    .filter(([key, value]) => key !== "page" && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(kept).toString();
}
