/** Page arithmetic for link-based pagination. Pages are 1-based. */

export function pageCountFor(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
}

/** Parses a `?page=` value: anything that is not a positive integer becomes 1. */
export function parsePage(value: string | string[] | null | undefined): number {
  const first = Array.isArray(value) ? value[0] : value;
  const parsed = Number(first);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Inclusive 1-based row range shown on a page ("26-50 of 130"); zeros when there is nothing. */
export function pageRange(
  page: number,
  pageSize: number,
  total: number
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const current = clampPage(page, pageCountFor(total, pageSize));
  const from = (current - 1) * pageSize + 1;
  return { from, to: Math.min(total, current * pageSize) };
}

export type PageItem = number | "ellipsis-start" | "ellipsis-end";

/**
 * The page numbers to render: first, last, the current page and `siblings` on each side. A gap of
 * exactly one page is filled with that page (an ellipsis hiding a single page is pointless); wider
 * gaps become an ellipsis.
 */
export function pageWindow(page: number, pageCount: number, siblings = 1): PageItem[] {
  const last = Math.max(1, pageCount);
  const current = clampPage(page, last);
  const wanted = new Set<number>([1, last]);
  for (let n = current - siblings; n <= current + siblings; n++) {
    if (n >= 1 && n <= last) wanted.add(n);
  }
  const sorted = [...wanted].sort((a, b) => a - b);

  const items: PageItem[] = [];
  let previous = 0;
  for (const n of sorted) {
    const gap = n - previous;
    if (previous > 0 && gap === 2) items.push(previous + 1);
    else if (previous > 0 && gap > 2) items.push(n < current ? "ellipsis-start" : "ellipsis-end");
    items.push(n);
    previous = n;
  }
  return items;
}
