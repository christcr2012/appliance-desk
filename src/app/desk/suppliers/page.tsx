import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getSuppliersPage } from "@/domains/purchasing/suppliers-page";
import { EmptyState } from "@/components/ui";
import { ScreenHeader, StatusPill, StatusTabs, Toolbar } from "@/components/kit";
import { SUPPLIERS_TABS, encodeSuppliersCursor, parseSuppliersParams, suppliersHref } from "./params";

export const metadata = { title: "Suppliers" };

/**
 * AR-6b section 7: the Suppliers list — Active/Archived tabs, a
 * name/contact search, and cursor paging over getSuppliersPage. Each
 * row carries the contact person, a tap-to-call phone and the combined
 * order count (purchase orders + appliance purchases).
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole("OWNER", "ADMIN");
  const raw = await searchParams;
  // Stale ?open= links (the old table's side-panel convention) go straight
  // to the supplier's record, as before.
  if (raw.open) redirect(`/desk/suppliers/${encodeURIComponent(raw.open)}`);
  const params = parseSuppliersParams(raw);
  const list = await getSuppliersPage(params);

  return (
    <div>
      <ScreenHeader
        title="Suppliers"
        list
        primary={{ kind: "link", label: "Add supplier", href: "/desk/suppliers/new" }}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Where you order parts and pick up appliances. Archived suppliers keep their history but can&apos;t be used on new orders.
      </p>

      <div className="mb-4">
        <StatusTabs
          label="Filter suppliers"
          param="status"
          current={params.status}
          items={SUPPLIERS_TABS.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>

      <Toolbar
        search={{ param: "q", placeholder: "Name or contact", label: "Search suppliers" }}
      />

      {list.rows.length === 0 ? (
        params.q ? (
          <EmptyState title="No suppliers here" description="Nothing matches that search. Clear it to see every supplier." />
        ) : params.status === "archived" ? (
          <EmptyState title="No archived suppliers" description="Suppliers you archive will show here so you can restore them." />
        ) : (
          <EmptyState title="No suppliers yet" description="Add your first supplier to start an order." />
        )
      ) : (
        <div className="space-y-3">
          <ul aria-label="Suppliers" className="divide-y divide-line rounded-card border border-line bg-surface">
            {list.rows.map((supplier) => (
              <li key={supplier.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/desk/suppliers/${supplier.id}`}
                    className="font-semibold text-ink underline-offset-4 hover:underline"
                  >
                    {supplier.name}
                  </Link>
                  {supplier.contactName && (
                    <p className="mt-1 text-sm text-ink-soft">{supplier.contactName}</p>
                  )}
                </div>
                {supplier.phone && (
                  <a
                    href={`tel:${supplier.phone}`}
                    className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {supplier.phone}
                  </a>
                )}
                <span className="text-sm text-ink-soft sm:w-24 sm:text-right">
                  {supplier.orderCount} {supplier.orderCount === 1 ? "order" : "orders"}
                </span>
                {supplier.archived && <StatusPill tone="neutral" label="Archived" />}
              </li>
            ))}
          </ul>
          {list.nextCursor && (
            <div className="flex justify-center">
              <Link
                href={suppliersHref(params, { cursor: encodeSuppliersCursor(list.nextCursor) })}
                className="rounded-control border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
              >
                Load more
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
