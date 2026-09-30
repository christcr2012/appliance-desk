import Link from "next/link";

/** Prev/next pager shared by the desk's bigger lists — see
 * src/domains/pagination.ts for the page-math this renders. Renders
 * nothing for a single-page list (nothing to page through). The
 * boundary end is plain text, not a dead link, so there's nothing
 * confusing to click when already on the first/last page. */
export function Pagination({
  page,
  totalPages,
  totalCount,
  buildHref,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft"
    >
      {page > 1 ? (
        <Link
          href={buildHref(page - 1)}
          className="inline-flex min-h-11 items-center rounded-lg border border-control px-3 py-2 text-ink hover:bg-subtle"
        >
          &larr; Previous
        </Link>
      ) : (
        <span className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-2 text-ink-soft">
          &larr; Previous
        </span>
      )}
      <span>
        Page {page} of {totalPages} ({totalCount} total)
      </span>
      {page < totalPages ? (
        <Link
          href={buildHref(page + 1)}
          className="inline-flex min-h-11 items-center rounded-lg border border-control px-3 py-2 text-ink hover:bg-subtle"
        >
          Next &rarr;
        </Link>
      ) : (
        <span className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-2 text-ink-soft">
          Next &rarr;
        </span>
      )}
    </nav>
  );
}
