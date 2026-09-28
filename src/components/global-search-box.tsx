/** Desk-wide search — a plain GET form to /desk/search, no JS required.
 * See src/domains/search for what it looks across. */
export function GlobalSearchBox() {
  return (
    <form action="/desk/search" method="get" className="w-full max-w-sm">
      <label htmlFor="global-search" className="sr-only">
        Search customers, appliances, and leads
      </label>
      <input
        id="global-search"
        name="q"
        type="search"
        placeholder="Search customers, appliances, leads…"
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
      />
    </form>
  );
}
