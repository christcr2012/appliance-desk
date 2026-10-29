import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import {
  ButtonLink,
  EmptyState,
  StatusPill,
} from "@/components/ui";
import { DataTable, ScreenHeader, Toolbar, type Column, type FilterDef } from "@/components/kit";

export const metadata = { title: "Suppliers" };

type SupplierRow = Awaited<ReturnType<typeof getSuppliers>>[number];

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const showArchived = (await searchParams).archived === "1";
  const suppliers = await getSuppliers({ includeArchived: showArchived });

  const columns: Column<SupplierRow>[] = [
    {
      key: "supplier",
      header: "Supplier",
      cell: (supplier) => (
        <div>
          <Link
            href={`/desk/suppliers/${supplier.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {supplier.name}
          </Link>
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
