import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import {
  EmptyState,
  StatusPill,
} from "@/components/ui";
import { DataTable, ScreenHeader, Toolbar, type Column, type FilterDef } from "@/components/kit";

export const metadata = { title: "Suppliers" };

type SupplierRow = Awaited<ReturnType<typeof getSuppliers>>[number];

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; open?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const suppliersParams = await searchParams;
  // The kit table's row click sets ?open=<id> (its side-panel convention).
  // Suppliers have no side panel — the record page IS the destination, as
  // it was before the redesign — so an ?open= link goes straight there.
  if (suppliersParams.open) redirect(`/desk/suppliers/${encodeURIComponent(suppliersParams.open)}`);
  const showArchived = suppliersParams.archived === "1";
  const suppliers = await getSuppliers({ includeArchived: showArchived });

  const columns: Column<SupplierRow>[] = [
    {
      key: "supplier",
      header: "Supplier",
      cell: (supplier) => (
        <div>
          <span className="font-semibold text-ink">{supplier.name}</span>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {supplier.contactName ?? ""}
            {supplier.contactName && (supplier.phone || supplier.email)
              ? " · "
              : ""}
            {supplier.phone ?? ""}
            {supplier.phone && supplier.email ? " · " : ""}
            {supplier.email ?? ""}
          </p>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (supplier) =>
        supplier.archivedAt ? (
          <StatusPill tone="stopped" label="Archived" />
        ) : (
          <StatusPill tone="success" label="Active" />
        ),
    },
    {
      key: "orders",
      header: "Purchase orders",
      cell: (supplier) =>
        `${supplier._count.purchaseOrders} purchase ${
          supplier._count.purchaseOrders === 1 ? "order" : "orders"
        }`,
    },
  ];

  return (
    <div>
      <ScreenHeader
        title="Suppliers"
        list
        primary={{ kind: "link", label: "Add supplier", href: "/desk/suppliers/new" }}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">Who you order parts and appliances from.</p>
      <Toolbar
        filters={[{ kind: "toggle", param: "archived", label: "Show archived suppliers" }] satisfies FilterDef[]}
      />

      <DataTable
        rows={suppliers}
        rowKey={(supplier) => supplier.id}
        columns={columns}
        caption="Suppliers"
        rowHref={(supplier) => `/desk/suppliers/${supplier.id}`}
        mobileCard={(supplier) => columns[0].cell(supplier)}
        empty={
          <EmptyState
            title="No suppliers on file yet"
            description="Add a supplier when you are ready to track purchasing."
          />
        }
      />
    </div>
  );
}
