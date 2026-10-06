import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getPurchaseOrderById } from "@/domains/purchasing";
import { formatCents } from "@/domains/pricing";
import {
  ButtonLink,
  Card,
  DataList,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import type { StatusTone } from "@/components/status-badge";
import { PurchaseOrderActionsPanel } from "./purchase-order-actions-panel";

export const metadata = { title: "Purchase order" };

const STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: "pending",
  ORDERED: "progress",
  RECEIVED: "success",
  CANCELLED: "stopped",
};

type PurchaseOrderRecord = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrderById>>
>;
type PurchaseOrderLine = PurchaseOrderRecord["lines"][number];

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

  const totalCents = order.lines.reduce(
    (sum, line) =>
      sum +
      (line.unitCostKnown ? line.unitCostCents * line.quantity : 0),
    0,
  );
  const unknownPriceLines = order.lines.filter(
    (line) => !line.unitCostKnown,
  ).length;

  const columns: DataListColumn<PurchaseOrderLine>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      cell: (line) => (
        <div>
          <p className="font-semibold text-ink">{line.description}</p>
          {line.partRecord && (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {line.partRecord.modelNumber} — {line.partRecord.partNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Quantity",
      cell: (line) => String(line.quantity),
    },
    {
      key: "price",
      header: "Known price",
      cell: (line) =>
        line.unitCostKnown
          ? formatCents(line.unitCostCents * line.quantity)
          : "Price not known",
    },
    {
      key: "received",
      header: "Received",
      cell: (line) =>
        order.status === "DRAFT"
          ? "Not ordered yet"
          : `${line.receivedQuantity} of ${line.quantity} arrived`,
    },
  ];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={order.supplier.name}
        description={`Created ${new Date(
          order.createdAt,
        ).toLocaleDateString()} by ${
          order.createdBy.name ?? order.createdBy.email
        }`}
        secondaryActions={
          <>
            <ButtonLink
              href={`/desk/suppliers/${order.supplier.id}`}
              variant="secondary"
            >
              Supplier
            </ButtonLink>
            <ButtonLink href="/desk/purchase-orders" variant="secondary">
              All purchase orders
            </ButtonLink>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusPill
          tone={STATUS_TONE[order.status] ?? "pending"}
          label={order.status}
        />
        {order.status === "RECEIVED" && order.receivedAt && (
          <span className="text-sm font-medium text-success">
            Fully received{" "}
            {new Date(order.receivedAt).toLocaleDateString()}
          </span>
        )}
        {order.status === "CANCELLED" && (
          <span className="text-sm text-ink-soft">
            This order was cancelled.
          </span>
        )}
      </div>

      {order.notes && (
        <div className="mb-6">
          <Card title="Notes">
            <p className="text-sm text-ink-soft">{order.notes}</p>
          </Card>
        </div>
      )}

      <DataList
        rows={order.lines}
        columns={columns}
        caption="Purchase order lines"
        empty={null}
      />

      <div className="mt-4">
        <Card title="Order total">
          <p className="text-lg font-semibold text-ink">
            {formatCents(totalCents)} total
            {unknownPriceLines > 0
              ? ` (${unknownPriceLines} line${
                  unknownPriceLines === 1 ? "" : "s"
                } without a price)`
              : ""}
          </p>
        </Card>
      </div>

      {(order.status === "DRAFT" || order.status === "ORDERED") && (
        <div className="mt-6">
          <PurchaseOrderActionsPanel
            purchaseOrderId={order.id}
            status={order.status}
            lines={order.lines.map((line) => ({
              id: line.id,
              description: line.description,
              outstanding: Math.max(
                0,
                line.quantity - line.receivedQuantity,
              ),
              unitCostKnown: line.unitCostKnown,
              unitCostCents: line.unitCostCents,
              hasPart: line.partRecordId !== null,
            }))}
          />
        </div>
      )}
    </div>
  );
}
