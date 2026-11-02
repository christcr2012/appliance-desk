import type { PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/**
 * AR-6b section 5: the parts-orders list read + the order status words.
 *
 * Replaces getPurchaseOrders (every order with every line, unbounded).
 * Cursor-paged on (createdAt desc, id desc) — the fleet fix-7 rule, so
 * orders placed in the same instant appear once each across pages. The
 * known total is computed here, never in a page: a line counts only when
 * its price is known (unitCostKnown), at quantity ordered.
 */

export const PURCHASE_ORDER_PILL: Record<
  PurchaseOrderStatus,
  { label: string; tone: "good" | "info" | "attention" | "neutral" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ORDERED: { label: "Ordered", tone: "info" },
  RECEIVED: { label: "Arrived", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** The list's status tabs: "open" is the working set (drafts + placed). */
export type PurchaseOrderListStatus = "open" | "received" | "cancelled";

export const PURCHASE_ORDER_LIST_STATUSES: Record<PurchaseOrderListStatus, PurchaseOrderStatus[]> = {
  open: ["DRAFT", "ORDERED"],
  received: ["RECEIVED"],
  cancelled: ["CANCELLED"],
};

export type PurchaseOrderPageParams = {
  status?: PurchaseOrderListStatus;
  supplierId?: string;
  cursor?: { createdAt: string; id: string };
  take?: number;
};

export type PurchaseOrderPageRow = {
  id: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  createdAt: Date;
  receivedAt: Date | null;
  lineCount: number;
  /** Sum of quantity × unit price over the lines whose price is known. */
  knownTotalCents: number;
  /** Lines with no known price yet — the list shows "+ n unpriced". */
  unpricedLines: number;
};

export async function getPurchaseOrdersPage(
  params: PurchaseOrderPageParams = {},
): Promise<{ rows: PurchaseOrderPageRow[]; nextCursor: { createdAt: string; id: string } | null }> {
  await requireRole("OWNER", "ADMIN");
  const take = Math.min(Math.max(params.take ?? 50, 1), 200);
  const statuses = PURCHASE_ORDER_LIST_STATUSES[params.status ?? "open"];
  const cursor = params.cursor
    ? { createdAt: new Date(params.cursor.createdAt), id: params.cursor.id }
    : null;

  const page = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: statuses },
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      status: true,
      supplierId: true,
      createdAt: true,
      receivedAt: true,
      supplier: { select: { name: true } },
      lines: { select: { quantity: true, unitCostCents: true, unitCostKnown: true } },
    },
  });
  const hasMore = page.length > take;
  const rows = (hasMore ? page.slice(0, take) : page).map((order) => ({
    id: order.id,
    status: order.status,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    createdAt: order.createdAt,
    receivedAt: order.receivedAt,
    lineCount: order.lines.length,
    knownTotalCents: order.lines.reduce(
      (sum, line) => sum + (line.unitCostKnown ? line.unitCostCents * line.quantity : 0),
      0,
    ),
    unpricedLines: order.lines.filter((line) => !line.unitCostKnown).length,
  }));
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
  };
}
