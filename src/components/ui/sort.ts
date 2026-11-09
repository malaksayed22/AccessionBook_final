/** Sort state helpers for URL-driven tables. Pure, so they run in server and client code alike. */
export type SortOrder = "asc" | "desc";

export type SortState = { sort?: string | null; order?: SortOrder };

export function parseSortOrder(
  value: string | string[] | null | undefined,
  fallback: SortOrder = "asc"
): SortOrder {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "asc" || first === "desc" ? first : fallback;
}

/** Clicking the active column flips its direction; any other column starts ascending. */
export function nextSortOrder(current: SortState, key: string): SortOrder {
  if (current.sort !== key) return "asc";
  return current.order === "desc" ? "asc" : "desc";
}

/** Value for the `aria-sort` attribute of a column header; only the active column gets one. */
export function ariaSortFor(
  current: SortState,
  key: string
): "ascending" | "descending" | undefined {
  if (current.sort !== key) return undefined;
  return current.order === "desc" ? "descending" : "ascending";
}
