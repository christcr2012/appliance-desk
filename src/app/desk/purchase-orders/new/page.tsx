import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import { getAllPartRecords } from "@/domains/inventory";
import { ButtonLink,
  Card,
  EmptyState } from "@/components/ui";
import { NewPurchaseOrderForm } from "./new-purchase-order-form";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  await requireRole("OWNER", "ADMIN");
  const [suppliers, partRecords] = await Promise.all([
    getSuppliers(),
    getAllPartRecords(),
  ]);

  return (
    <div className="max-w-3xl">
      <Link href="/desk/purchase-orders" className="text-sm text-ink-soft hover:underline">
        &larr; Back to purchase orders
      </Link>

      <h1 className="mt-2 text-xl font-semibold">New purchase order</h1>
      <p className="mt-1 text-sm text-ink-soft">Create an order from an active supplier and record known or unknown line pricing.</p>

      {suppliers.length === 0 ? (
        <EmptyState
          title="Add a supplier first"
          description="Purchase orders require an active supplier."
          action={
            <ButtonLink href="/desk/suppliers/new" variant="secondary">
              Add supplier
            </ButtonLink>
          }
        />
      ) : (
        <Card title="Order details">
          <NewPurchaseOrderForm
            suppliers={suppliers.map((supplier) => ({
              id: supplier.id,
              name: supplier.name,
            }))}
            partRecords={partRecords.map((part) => ({
              id: part.id,
              sellable: part.sellable,
              defaultForResale: part.defaultForResale,
              label: `${part.modelNumber} — ${part.partNumber}${
                part.partName ? ` (${part.partName})` : ""
              }`,
            }))}
          />
        </Card>
      )}
    </div>
  );
}
