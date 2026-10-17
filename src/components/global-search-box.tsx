import { SearchShortcut } from "./search-shortcut";

/** Desk-wide search — a plain GET form to /desk/search, no JS required.
 * See src/domains/search for what it looks across. The shortcut hint and the Cmd K / Ctrl K key only focus this same
 * box; there is no other search. */
export function GlobalSearchBox() {
  return (
    <form
      action="/desk/search"
      method="get"
      className="relative w-full max-w-sm min-w-0"
    >
      <label htmlFor="global-search" className="sr-only">
        Search customers, appliances, and leads
      </label>
      <input
        id="global-search"
        name="q"
        type="search"
        placeholder="Search or jump to…"
        aria-keyshortcuts="Control+K Meta+K"
        className="min-h-11 w-full rounded-lg border border-control bg-surface py-2 pl-3 pr-16 text-sm text-ink"
      />
      <SearchShortcut />
    </form>
  );
}
