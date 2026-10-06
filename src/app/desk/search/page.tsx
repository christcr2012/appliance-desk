import Link from "next/link";
import { searchAll } from "@/domains/search";

export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = await searchAll(q ?? "");
  const totalFound = results.customers.length + results.appliances.length + results.leads.length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Search</h1>

      <form action="/desk/search" method="get" className="mt-4 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search customers, appliances, and leads
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={results.query}
          placeholder="Customer name, email, asset number…"
          className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action"
        >
          Search
        </button>
      </form>

      {!results.query ? (
        <p className="mt-6 text-sm text-ink-soft">
          Search across customers, appliances, and leads.
        </p>
      ) : totalFound === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          Nothing found for &ldquo;{results.query}&rdquo;.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {results.customers.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-ink-faint">Customers</h2>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
                {results.customers.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/desk/customers/${c.id}`}
                      className="block px-4 py-3 text-sm hover:bg-canvas"
                    >
                      <span className="font-medium text-ink">{c.name}</span>
                      {c.companyName && ` — ${c.companyName}`}
                      <span className="text-ink-faint"> · {c.email}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.appliances.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-ink-faint">Appliances</h2>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
                {results.appliances.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/desk/inventory/${a.id}`}
                      className="block px-4 py-3 text-sm hover:bg-canvas"
                    >
                      <span className="font-medium text-ink">
                        {a.assetNumber} — {a.typeName}
                      </span>
                      {a.manufacturer && <span className="text-ink-faint"> · {a.manufacturer}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.leads.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-ink-faint">Leads</h2>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
                {results.leads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/desk/leads/${l.id}`}
                      className="block px-4 py-3 text-sm hover:bg-canvas"
                    >
                      <span className="font-medium text-ink">{l.contactName}</span>
                      {l.email && <span className="text-ink-faint"> · {l.email}</span>}
                      <span className="ml-2 text-xs text-ink-faint">{l.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
