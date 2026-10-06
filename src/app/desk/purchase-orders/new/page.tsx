import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import { getAllPartRecords } from "@/domains/inventory";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
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
      <PageHeader
        title="New purchase order"
        description="Create an order from an active supplier and record known or unknown line pricing."
        secondaryActions={
          <ButtonLink href="/desk/purchase-orders" variant="secondary">
            All purchase orders
          </ButtonLink>
        }
      />

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
