import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import { getAllPartRecords } from "@/domains/inventory";
import { NewPurchaseOrderForm } from "./new-purchase-order-form";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  await requireRole("OWNER", "ADMIN");
  const [suppliers, partRecords] = await Promise.all([getSuppliers(), getAllPartRecords()]);

  return (
    <div className="max-w-2xl">
      <Link href="/desk/purchase-orders" className="text-sm text-ink-soft hover:underline">
        &larr; All purchase orders
      </Link>
      <h1 className="mt-2 text-xl font-semibold">New purchase order</h1>

      {suppliers.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          You need a supplier on file first —{" "}
          <Link href="/desk/suppliers/new" className="underline">
            add one
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4">
          <NewPurchaseOrderForm
            suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
            partRecords={partRecords.map((p) => ({
              id: p.id,
              label: `${p.modelNumber} — ${p.partNumber}${p.partName ? ` (${p.partName})` : ""}`,
            }))}
          />
        </div>
      )}
    </div>
  );
}
