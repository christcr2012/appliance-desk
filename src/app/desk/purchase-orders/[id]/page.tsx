import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getPurchaseOrderById } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";
import { PurchaseOrderActionsPanel } from "./purchase-order-actions-panel";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const order = await getPurchaseOrderById(id);

  if (!order) {
    notFound();
  }

  const totalCents = order.lines.reduce((sum, l) => sum + l.unitCostCents * l.quantity, 0);

  return (
    <div className="max-w-2xl">
      <Link href="/desk/purchase-orders" className="text-sm text-gray-600 hover:underline">
        &larr; All purchase orders
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            <Link href={`/desk/suppliers/${order.supplier.id}`} className="hover:underline">
              {order.supplier.name}
            </Link>
          </h1>
          <p className="text-sm text-gray-600">
            Created {new Date(order.createdAt).toLocaleDateString()} by{" "}
            {order.createdBy.name ?? order.createdBy.email}
          </p>
        </div>
        <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
          {order.status}
        </span>
      </div>

      {order.notes && <p className="mt-4 text-sm text-gray-700">{order.notes}</p>}

      <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {order.lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm text-gray-900">
                {line.quantity}× {line.description}
              </p>
              {line.partRecord && (
                <p className="text-xs text-gray-500">
                  {line.partRecord.modelNumber} — {line.partRecord.partNumber}
                </p>
              )}
            </div>
            <p className="text-sm text-gray-600">{formatCents(line.unitCostCents * line.quantity)}</p>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex justify-end text-sm font-medium text-gray-900">
        {formatCents(totalCents)} total
      </div>

      {order.status === "RECEIVED" && order.receivedAt && (
        <p className="mt-4 text-sm text-green-700">
          Received {new Date(order.receivedAt).toLocaleDateString()} — parts already added to stock.
        </p>
      )}
      {order.status === "CANCELLED" && <p className="mt-4 text-sm text-gray-500">This order was cancelled.</p>}

      {(order.status === "DRAFT" || order.status === "ORDERED") && (
        <div className="mt-6">
          <PurchaseOrderActionsPanel purchaseOrderId={order.id} status={order.status} />
        </div>
      )}
    </div>
  );
}
