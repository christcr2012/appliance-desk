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
      <Link href="/desk/suppliers" className="text-sm text-gray-600 hover:underline">
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

      <h2 className="mt-8 text-sm font-medium text-gray-900">Purchase orders</h2>
      {supplier.purchaseOrders.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">
          No purchase orders yet — start one from{" "}
          <Link href="/desk/purchase-orders/new" className="underline">
            Purchase orders
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {supplier.purchaseOrders.map((po) => {
            const totalCents = po.lines.reduce(
              (sum, l) => sum + l.unitCostCents * l.quantity,
              0,
            );
            return (
              <li key={po.id}>
                <Link
                  href={`/desk/purchase-orders/${po.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  <span className="text-sm text-gray-900">
                    {new Date(po.createdAt).toLocaleDateString()} — {po.lines.length}{" "}
                    {po.lines.length === 1 ? "line" : "lines"}
                  </span>
                  <span className="text-sm text-gray-600">
                    {po.status} · {formatCents(totalCents)}
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
