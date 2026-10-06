import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import {
  ButtonLink,
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";

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

  const columns: DataListColumn<SupplierRow>[] = [
    {
      key: "supplier",
      header: "Supplier",
      primary: true,
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
      <PageHeader
        title="Suppliers"
        description="Who you order parts and appliances from."
        primaryAction={{ href: "/desk/suppliers/new", label: "Add supplier" }}
        secondaryActions={
          <ButtonLink
            href={showArchived ? "/desk/suppliers" : "/desk/suppliers?archived=1"}
            variant="secondary"
          >
            {showArchived ? "Hide archived suppliers" : "Show archived suppliers"}
          </ButtonLink>
        }
      />

      <DataList
        rows={suppliers}
        columns={columns}
        caption="Suppliers"
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
