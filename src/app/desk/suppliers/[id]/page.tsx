import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSupplierById } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";
import {
  ButtonLink,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";
import { SupplierDetailClient } from "./supplier-detail-client";
import { SupplierArchiveButton } from "./supplier-archive-button";

export const metadata = { title: "Supplier" };

type SupplierRecord = NonNullable<Awaited<ReturnType<typeof getSupplierById>>>;
type PurchaseOrderRow = SupplierRecord["purchaseOrders"][number];

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }

  const columns: DataListColumn<PurchaseOrderRow>[] = [
    {
      key: "order",
      header: "Purchase order",
      primary: true,
      cell: (order) => (
        <Link
          href={`/desk/purchase-orders/${order.id}`}
          className="font-semibold text-ink underline-offset-4 hover:underline"
        >
          {new Date(order.createdAt).toLocaleDateString()}
        </Link>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      cell: (order) =>
        `${order.lines.length} ${order.lines.length === 1 ? "line" : "lines"}`,
    },
    {
      key: "status",
      header: "Status",
      cell: (order) => order.status,
    },
    {
      key: "total",
      header: "Known total",
      cell: (order) => {
        const totalCents = order.lines.reduce(
          (sum, line) =>
            sum +
            (line.unitCostKnown ? line.unitCostCents * line.quantity : 0),
          0,
        );
        const unpriced = order.lines.filter(
          (line) => !line.unitCostKnown,
        ).length;
        return (
          <span>
            {formatCents(totalCents)}
            {unpriced > 0 ? ` + ${unpriced} unpriced` : ""}
          </span>
        );
      },
    },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={supplier.name}
        description="Supplier contact details, purchasing availability, and purchase-order history."
        secondaryActions={
          <ButtonLink href="/desk/suppliers" variant="secondary">
            All suppliers
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        <SupplierDetailClient
          supplierId={supplier.id}
          initial={{
            name: supplier.name,
            contactName: supplier.contactName ?? "",
            phone: supplier.phone ?? "",
            email: supplier.email ?? "",
            notes: supplier.notes ?? "",
          }}
        />

        <SupplierArchiveButton
          supplierId={supplier.id}
          archived={supplier.archivedAt !== null}
        />

        <section aria-labelledby="supplier-purchase-orders">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="supplier-purchase-orders"
              className="text-lg font-semibold text-ink"
            >
              Purchase orders
            </h2>
            <ButtonLink
              href="/desk/purchase-orders/new"
              variant="secondary"
            >
              New purchase order
            </ButtonLink>
          </div>

          <DataList
            rows={supplier.purchaseOrders}
            columns={columns}
            caption="Supplier purchase orders"
            empty={
              <EmptyState
                title="No purchase orders yet"
                description="Start a purchase order when you are ready to buy from this supplier."
              />
            }
          />
        </section>
      </div>
    </div>
  );
}
