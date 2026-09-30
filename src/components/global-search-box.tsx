/** Desk-wide search — a plain GET form to /desk/search, no JS required.
 * See src/domains/search for what it looks across. */
export function GlobalSearchBox() {
  return (
    <form
      action="/desk/search"
      method="get"
      className="w-full max-w-sm min-w-0"
    >
      <label htmlFor="global-search" className="sr-only">
        Search customers, appliances, and leads
      </label>
      <input
        id="global-search"
        name="q"
        type="search"
        placeholder="Search customers, appliances, leads…"
        className="min-h-11 w-full rounded-lg border border-control bg-surface px-3 py-2 text-sm text-ink"
      />
    </form>
  );
}
