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

  const totalCents = order.lines.reduce((sum, l) => sum + (l.unitCostKnown ? l.unitCostCents * l.quantity : 0), 0);
  const unknownPriceLines = order.lines.filter((l) => !l.unitCostKnown).length;

  return (
    <div className="max-w-2xl">
      <Link href="/desk/purchase-orders" className="text-sm text-ink-soft hover:underline">
        &larr; All purchase orders
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            <Link href={`/desk/suppliers/${order.supplier.id}`} className="hover:underline">
              {order.supplier.name}
            </Link>
          </h1>
          <p className="text-sm text-ink-soft">
            Created {new Date(order.createdAt).toLocaleDateString()} by{" "}
            {order.createdBy.name ?? order.createdBy.email}
          </p>
        </div>
        <span className="inline-block rounded-full bg-canvas-alt px-3 py-1 text-sm font-medium text-ink-soft">
          {order.status}
        </span>
      </div>

      {order.notes && <p className="mt-4 text-sm text-ink-soft">{order.notes}</p>}

      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
        {order.lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm text-ink">
                {line.quantity}× {line.description}
              </p>
              {line.partRecord && (
                <p className="text-xs text-ink-faint">
                  {line.partRecord.modelNumber} — {line.partRecord.partNumber}
                </p>
              )}
            </div>
            <div className="text-right text-sm text-ink-soft">
              <p>{line.unitCostKnown ? formatCents(line.unitCostCents * line.quantity) : "price not known"}</p>
              {order.status !== "DRAFT" && (
                <p className="text-xs text-ink-faint">
                  {line.receivedQuantity} of {line.quantity} arrived
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex justify-end text-sm font-medium text-ink">
        {formatCents(totalCents)} total{unknownPriceLines > 0 ? ` (${unknownPriceLines} line${unknownPriceLines === 1 ? "" : "s"} without a price)` : ""}
      </div>

      {order.status === "RECEIVED" && order.receivedAt && (
        <p className="mt-4 text-sm text-green-700">
          Fully received {new Date(order.receivedAt).toLocaleDateString()} — parts already added to stock.
        </p>
      )}
      {order.status === "CANCELLED" && <p className="mt-4 text-sm text-ink-faint">This order was cancelled.</p>}

      {(order.status === "DRAFT" || order.status === "ORDERED") && (
        <div className="mt-6">
          <PurchaseOrderActionsPanel
            purchaseOrderId={order.id}
            status={order.status}
            lines={order.lines.map((l) => ({
              id: l.id,
              description: l.description,
              outstanding: Math.max(0, l.quantity - l.receivedQuantity),
              unitCostKnown: l.unitCostKnown,
              unitCostCents: l.unitCostCents,
              hasPart: l.partRecordId !== null,
            }))}
          />
        </div>
      )}
    </div>
  );
}
