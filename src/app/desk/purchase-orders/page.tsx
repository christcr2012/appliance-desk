import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getPurchaseOrders } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";

export const metadata = { title: "Purchase orders" };

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "text-gray-500",
  ORDERED: "text-amber-700",
  RECEIVED: "text-green-700",
  CANCELLED: "text-gray-400 line-through",
};

export default async function PurchaseOrdersPage() {
  await requireRole("OWNER", "ADMIN");
  const orders = await getPurchaseOrders();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Purchase orders</h1>
        <Link
          href="/desk/purchase-orders/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + New purchase order
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Parts and supplies you&apos;ve ordered, and whether they&apos;ve arrived.
      </p>

      {orders.length === 0 ? (
        <p className="mt-8 text-sm text-gray-600">
          No purchase orders yet — start one, or{" "}
          <Link href="/desk/suppliers/new" className="underline">
            add a supplier
          </Link>{" "}
          first if you haven&apos;t.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {orders.map((po) => {
            const totalCents = po.lines.reduce((sum, l) => sum + l.unitCostCents * l.quantity, 0);
            return (
              <li key={po.id}>
                <Link
                  href={`/desk/purchase-orders/${po.id}`}
                  className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900">{po.supplier.name}</p>
                    <p className="text-sm text-gray-600">
                      {po.lines.length} {po.lines.length === 1 ? "line" : "lines"} ·{" "}
                      {new Date(po.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <p className={STATUS_STYLES[po.status] ?? "text-gray-600"}>{po.status}</p>
                    <p className="text-gray-500">{formatCents(totalCents)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
