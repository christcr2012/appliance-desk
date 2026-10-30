import { searchAll } from "@/domains/search";
import { EmptyState } from "@/components/ui";
import { DataTable, ScreenHeader, Toolbar } from "@/components/kit";

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
    results.leads.length +
    results.purchases.length +
    results.sellers.length;

  return (
    <div className="max-w-3xl">
      <ScreenHeader title="Search" />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Find customers, appliances, leads, purchases and sellers from one place.
      </p>

      <Toolbar search={{ label: "Search customers, appliances, and leads", placeholder: "Customer name, email, appliance number…" }} />

      {!results.query ? (
        <EmptyState
          title="Start with a name, email, or appliance number"
          description="Search across customers, appliances, and leads."
        />
      ) : totalFound === 0 ? (
        <EmptyState
          title={`Nothing found for “${results.query}”`}
          description="Try a different name, email, city, or appliance number."
        />
      ) : (
        <div className="space-y-6">
          {results.customers.length > 0 && (
            <DataTable
              caption="Customers"
              rows={results.customers}
              rowKey={(customer) => customer.id}
              rowHref={(customer) => `/desk/customers/${customer.id}`}
              columns={[{
                key: "customer",
                header: "Customers",
                cell: (customer) => (
                  <span className="text-sm">
                    <span className="font-medium text-ink">{customer.name}</span>
                    {customer.companyName && ` — ${customer.companyName}`}
                    <span className="text-ink-faint">{" · "}{customer.email}</span>
                  </span>
                ),
              }]}
              mobileCard={(customer) => (
                <span className="text-sm">
                  <span className="font-medium text-ink">{customer.name}</span>
                  {customer.companyName && ` — ${customer.companyName}`}
                  <span className="text-ink-faint">{" · "}{customer.email}</span>
                </span>
              )}
              empty={null}
            />
          )}

          {results.appliances.length > 0 && (
            <DataTable
              caption="Appliances"
              rows={results.appliances}
              rowKey={(appliance) => appliance.id}
              rowHref={(appliance) => `/desk/inventory/${appliance.id}`}
              columns={[{
                key: "appliance",
                header: "Appliances",
                cell: (appliance) => (
                  <span className="text-sm">
                    <span className="font-medium text-ink">{appliance.assetNumber} — {appliance.typeName}</span>
                    {appliance.manufacturer && <span className="text-ink-faint">{" · "}{appliance.manufacturer}</span>}
                  </span>
                ),
              }]}
              mobileCard={(appliance) => (
                <span className="text-sm">
                  <span className="font-medium text-ink">{appliance.assetNumber} — {appliance.typeName}</span>
                  {appliance.manufacturer && <span className="text-ink-faint">{" · "}{appliance.manufacturer}</span>}
                </span>
              )}
              empty={null}
            />
          )}

          {results.purchases.length > 0 && (
            <DataTable
              caption="Purchases"
              rows={results.purchases}
              rowKey={(purchase) => purchase.id}
              rowHref={(purchase) => `/desk/purchases/${purchase.id}`}
              columns={[{
                key: "purchase",
                header: "Purchases",
                cell: (purchase) => (
                  <span className="text-sm">
                    <span className="font-medium text-ink">{purchase.seller}</span>
                    {purchase.reference && <span className="text-ink-faint">{" · receipt "}{purchase.reference}</span>}
                    <span className="text-ink-faint">{" · "}{purchase.purchasedOn.toLocaleDateString("en-US", { timeZone: "America/Denver" })}</span>
                  </span>
                ),
              }]}
              mobileCard={(purchase) => (
                <span className="text-sm">
                  <span className="font-medium text-ink">{purchase.seller}</span>
                  {purchase.reference && <span className="text-ink-faint">{" · receipt "}{purchase.reference}</span>}
                  <span className="text-ink-faint">{" · "}{purchase.purchasedOn.toLocaleDateString("en-US", { timeZone: "America/Denver" })}</span>
                </span>
              )}
              empty={null}
            />
          )}

          {results.sellers.length > 0 && (
            <DataTable
              caption="Sellers"
              rows={results.sellers}
              rowKey={(seller) => seller.id}
              rowHref={(seller) => `/desk/suppliers/${seller.id}`}
              columns={[{
                key: "seller",
                header: "Sellers",
                cell: (seller) => (
                  <span className="text-sm">
                    <span className="font-medium text-ink">{seller.name}</span>
                    {seller.contactName && <span className="text-ink-faint">{" · "}{seller.contactName}</span>}
                  </span>
                ),
              }]}
              mobileCard={(seller) => (
                <span className="text-sm">
                  <span className="font-medium text-ink">{seller.name}</span>
                  {seller.contactName && <span className="text-ink-faint">{" · "}{seller.contactName}</span>}
                </span>
              )}
              empty={null}
            />
          )}

          {results.leads.length > 0 && (
            <DataTable
              caption="Leads"
              rows={results.leads}
              rowKey={(lead) => lead.id}
              rowHref={(lead) => `/desk/leads/${lead.id}`}
              columns={[{
                key: "lead",
                header: "Leads",
                cell: (lead) => (
                  <span className="text-sm">
                    <span className="font-medium text-ink">{lead.contactName}</span>
                    {lead.email && <span className="text-ink-faint">{" · "}{lead.email}</span>}
                    <span className="ml-2 text-xs text-ink-faint">{lead.status}</span>
                  </span>
                ),
              }]}
              mobileCard={(lead) => (
                <span className="text-sm">
                  <span className="font-medium text-ink">{lead.contactName}</span>
                  {lead.email && <span className="text-ink-faint">{" · "}{lead.email}</span>}
                  <span className="ml-2 text-xs text-ink-faint">{lead.status}</span>
                </span>
              )}
              empty={null}
            />
          )}
        </div>
      )}
    </div>
  );
}
