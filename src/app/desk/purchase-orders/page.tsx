import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getPurchaseOrders } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";
import {
  EmptyState,
  StatusPill,
} from "@/components/ui";
import { DataTable, ScreenHeader, type Column } from "@/components/kit";
import type { StatusTone } from "@/components/status-badge";

export const metadata = { title: "Purchase orders" };

const STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "pending",
  ORDERED: "progress",
  RECEIVED: "success",
  CANCELLED: "stopped",
};

type PurchaseOrderRow = Awaited<ReturnType<typeof getPurchaseOrders>>[number];

export default async function PurchaseOrdersPage() {
  await requireRole("OWNER", "ADMIN");
  const orders = await getPurchaseOrders();

  const columns: Column<PurchaseOrderRow>[] = [
    {
      key: "order",
      header: "Purchase order",
      cell: (order) => (
        <div>
          <Link
            href={`/desk/purchase-orders/${order.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {order.supplier.name}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {order.lines.length} {order.lines.length === 1 ? "line" : "lines"}
            {" · "}
            {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (order) => (
        <StatusPill
          tone={STATUS_TONE[order.status] ?? "pending"}
          label={order.status}
        />
      ),
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
    <div>
      <ScreenHeader
        title="Purchase orders"
        list
        primary={{
          kind: "link",
          href: "/desk/purchase-orders/new",
          label: "New purchase order",
        }}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Parts and supplies you&apos;ve ordered, and whether they&apos;ve arrived.
      </p>

      <DataTable
        rows={orders}
        rowKey={(order) => order.id}
        columns={columns}
        caption="Purchase orders"
        mobileCard={(order) => (
          <div>
            {columns[0].cell(order)}
            <div className="mt-2">{columns[1].cell(order)}</div>
          </div>
        )}
        empty={
          <EmptyState
            title="No purchase orders yet"
            description="Start an order when you are ready to buy from a supplier."
          />
        }
      />
    </div>
  );
}
