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
      className="mt-6 flex items-center justify-between text-sm text-gray-600"
    >
      {page > 1 ? (
        <Link
          href={buildHref(page - 1)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-gray-400"
        >
          &larr; Previous
        </Link>
      ) : (
        <span className="rounded-md border border-gray-200 px-3 py-1.5 text-gray-400">
          &larr; Previous
        </span>
      )}
      <span>
        Page {page} of {totalPages} ({totalCount} total)
      </span>
      {page < totalPages ? (
        <Link
          href={buildHref(page + 1)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-700 hover:border-gray-400"
        >
          Next &rarr;
        </Link>
      ) : (
        <span className="rounded-md border border-gray-200 px-3 py-1.5 text-gray-400">
          Next &rarr;
        </span>
      )}
    </nav>
  );
}
