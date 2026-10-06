import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSupplierById } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";
import { SupplierDetailClient } from "./supplier-detail-client";
import { SupplierArchiveButton } from "./supplier-archive-button";

export const metadata = { title: "Supplier" };

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

  return (
    <div className="max-w-2xl">
      <Link href="/desk/suppliers" className="text-sm text-ink-soft hover:underline">
        &larr; All suppliers
      </Link>

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

      <SupplierArchiveButton supplierId={supplier.id} archived={supplier.archivedAt !== null} />

      <h2 className="mt-8 text-sm font-medium text-ink">Purchase orders</h2>
      {supplier.purchaseOrders.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">
          No purchase orders yet — start one from{" "}
          <Link href="/desk/purchase-orders/new" className="underline">
            Purchase orders
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
          {supplier.purchaseOrders.map((po) => {
            const totalCents = po.lines.reduce(
              (sum, l) => sum + (l.unitCostKnown ? l.unitCostCents * l.quantity : 0),
              0,
            );
            const unpriced = po.lines.filter((l) => !l.unitCostKnown).length;
            return (
              <li key={po.id}>
                <Link
                  href={`/desk/purchase-orders/${po.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas"
                >
                  <span className="text-sm text-ink">
                    {new Date(po.createdAt).toLocaleDateString()} — {po.lines.length}{" "}
                    {po.lines.length === 1 ? "line" : "lines"}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {po.status} · {formatCents(totalCents)}{unpriced > 0 ? ` + ${unpriced} unpriced` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
