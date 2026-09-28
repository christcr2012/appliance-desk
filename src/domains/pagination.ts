// ---------------------------------------------------------------------------
// Pagination (2026-09-28) — shared, pure helpers for the desk's bigger
// lists (customers, inventory, jobs, activity). Deliberately simple
// offset pagination (skip/take), not cursor-based — these lists are in
// the hundreds/low thousands for a business this size, not the scale
// where offset pagination's known downsides (drift on concurrent
// inserts, slow COUNT on huge tables) actually matter. No database
// import here — see src/domains/inventory/lifecycle.ts for why that
// pattern is used throughout this app.
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;

/** Parses a page-number searchParam, defaulting to 1 for anything
 * missing, non-numeric, or out of range — a bad/old link (e.g. someone
 * bookmarked page=4 and the list shrank) should never crash the page. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export type PaginationMeta = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  skip: number;
};

/** Clamps the requested page into range and computes the Prisma
 * skip/take this page actually needs. Always returns at least 1 total
 * page (an empty list is still "page 1 of 1", not "page 1 of 0"). */
export function paginationMeta(
  totalCount: number,
  requestedPage: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { page, pageSize, totalPages, totalCount, skip: (page - 1) * pageSize };
}
