import Link from "next/link";
import { searchAll } from "@/domains/search";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
} from "@/components/ui";

export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = await searchAll(q ?? "");
  const totalFound =
    results.customers.length +
    results.appliances.length +
    results.leads.length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Search"
        description="Find customers, appliances, and leads from one place."
      />

      <form
        action="/desk/search"
        method="get"
        className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      >
        <Field
          id="q"
          name="q"
          type="search"
          label="Search customers, appliances, and leads"
          defaultValue={results.query}
          placeholder="Customer name, email, asset number…"
        />
        <Button type="submit">Search</Button>
      </form>

      {!results.query ? (
        <EmptyState
          title="Start with a name, email, or asset number"
          description="Search across customers, appliances, and leads."
        />
      ) : totalFound === 0 ? (
        <EmptyState
          title={`Nothing found for “${results.query}”`}
          description="Try a different name, email, city, or asset number."
        />
      ) : (
        <div className="space-y-6">
          {results.customers.length > 0 && (
            <Card title="Customers">
              <ul className="divide-y divide-line">
                {results.customers.map((customer) => (
                  <li key={customer.id}>
                    <Link
                      href={`/desk/customers/${customer.id}`}
                      className="block min-h-11 rounded-control px-3 py-3 text-sm hover:bg-subtle"
                    >
                      <span className="font-medium text-ink">
                        {customer.name}
                      </span>
                      {customer.companyName && ` — ${customer.companyName}`}
                      <span className="text-ink-faint">
                        {" · "}
                        {customer.email}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {results.appliances.length > 0 && (
            <Card title="Appliances">
              <ul className="divide-y divide-line">
                {results.appliances.map((appliance) => (
                  <li key={appliance.id}>
                    <Link
                      href={`/desk/inventory/${appliance.id}`}
                      className="block min-h-11 rounded-control px-3 py-3 text-sm hover:bg-subtle"
                    >
                      <span className="font-medium text-ink">
                        {appliance.assetNumber} — {appliance.typeName}
                      </span>
                      {appliance.manufacturer && (
                        <span className="text-ink-faint">
                          {" · "}
                          {appliance.manufacturer}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {results.leads.length > 0 && (
            <Card title="Leads">
              <ul className="divide-y divide-line">
                {results.leads.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/desk/leads/${lead.id}`}
                      className="block min-h-11 rounded-control px-3 py-3 text-sm hover:bg-subtle"
                    >
                      <span className="font-medium text-ink">
                        {lead.contactName}
                      </span>
                      {lead.email && (
                        <span className="text-ink-faint">
                          {" · "}
                          {lead.email}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-ink-faint">
                        {lead.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
