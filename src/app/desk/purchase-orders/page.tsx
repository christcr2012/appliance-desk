import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getPurchaseOrders } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";
import {
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
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

  const columns: DataListColumn<PurchaseOrderRow>[] = [
    {
      key: "order",
      header: "Purchase order",
      primary: true,
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
      <PageHeader
        title="Purchase orders"
        description="Parts and supplies you've ordered, and whether they've arrived."
        primaryAction={{
          href: "/desk/purchase-orders/new",
          label: "New purchase order",
        }}
      />

      <DataList
        rows={orders}
        columns={columns}
        caption="Purchase orders"
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
