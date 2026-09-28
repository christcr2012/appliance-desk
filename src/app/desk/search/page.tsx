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
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Search
        </button>
      </form>

      {!results.query ? (
        <p className="mt-6 text-sm text-gray-600">
          Search across customers, appliances, and leads.
        </p>
      ) : totalFound === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          Nothing found for &ldquo;{results.query}&rdquo;.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {results.customers.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-gray-500">Customers</h2>
              <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                {results.customers.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/desk/customers/${c.id}`}
                      className="block px-4 py-3 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">{c.name}</span>
                      {c.companyName && ` — ${c.companyName}`}
                      <span className="text-gray-500"> · {c.email}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.appliances.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-gray-500">Appliances</h2>
              <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                {results.appliances.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/desk/inventory/${a.id}`}
                      className="block px-4 py-3 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">
                        {a.assetNumber} — {a.typeName}
                      </span>
                      {a.manufacturer && <span className="text-gray-500"> · {a.manufacturer}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.leads.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-gray-500">Leads</h2>
              <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                {results.leads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/desk/leads/${l.id}`}
                      className="block px-4 py-3 text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">{l.contactName}</span>
                      {l.email && <span className="text-gray-500"> · {l.email}</span>}
                      <span className="ml-2 text-xs text-gray-400">{l.status}</span>
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
