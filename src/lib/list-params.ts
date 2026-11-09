export const PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export const LOAD_MORE_STEP = 10;

const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

export type SortOrder = "asc" | "desc";

export type ListParams = {
  page: number;
  limit: number;
  sort: string;
  order: SortOrder;
  q?: string;
};

export function parseListParams(
  searchParams: Record<string, string | undefined>,
  defaults: { sort: string; order?: SortOrder }
): ListParams {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const requestedLimit = Math.floor(Number(searchParams.limit));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, requestedLimit))
      : PAGE_SIZE;
  const sort = searchParams.sort || defaults.sort;
  const order = searchParams.order === "asc" ? "asc" : defaults.order || "desc";
  const q = searchParams.q?.trim() || undefined;
  return { page, limit, sort, order, q };
}

export function buildListUrl(
  basePath: string,
  params: Record<string, string | number | undefined | null>,
  overrides?: Record<string, string | number | undefined | null>
): string {
  const merged = { ...params, ...overrides };
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const query = sp.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    total,
    totalPages,
    page: safePage,
    limit,
    showingFrom: total === 0 ? 0 : start + 1,
    showingTo: Math.min(start + limit, total),
  };
}

/** The value if it is one of `allowed`, otherwise undefined (URL parameters are untrusted text). */
export function pickParam<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/** Largest value of an `Int` column; a larger id in an address can never match a record. */
const MAX_INT_ID = 2_147_483_647;

/**
 * A positive integer from a URL parameter, or undefined. Values beyond the database's integer range
 * are undefined too, so a hand-edited address is ignored or a 404, never a database error.
 */
export function positiveIntParam(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_INT_ID ? n : undefined;
}
