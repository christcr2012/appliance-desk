import type { PurchaseListCursor } from "@/domains/purchasing/purchases";
import type { PurchaseOrderListStatus } from "@/domains/purchasing/orders-page";

/**
 * AR-6b section 5: the Purchases page's URL params.
 *
 * One page, two views (`view`): "purchases" (appliance receipts, default)
 * and "orders" (parts orders). Each view has its own cursor shape; the
 * URL carries one opaque `cursor` value, decoded for the active view —
 * switching views (StatusTabs) drops it, as does any filter change.
 */

export type PurchasesView = "purchases" | "orders";

export const PURCHASES_VIEWS: { value: PurchasesView; label: string }[] = [
  { value: "purchases", label: "Appliance purchases" },
  { value: "orders", label: "Parts orders" },
];

export const ORDER_STATUS_TABS: { value: PurchaseOrderListStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "received", label: "Arrived" },
  { value: "cancelled", label: "Cancelled" },
];

export type PurchasesParams = {
  view: PurchasesView;
  q: string;
  /** Supplier id filter (both views). */
  seller?: string;
  /** Orders view only. */
  status: PurchaseOrderListStatus;
  purchaseCursor?: PurchaseListCursor;
  orderCursor?: { createdAt: string; id: string };
};

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function encodePurchaseCursor(cursor: PurchaseListCursor): string {
  return encodeCursor({ k: "p", ...cursor });
}

export function encodeOrderCursor(cursor: { createdAt: string; id: string }): string {
  return encodeCursor({ k: "o", ...cursor });
}

export function parsePurchasesParams(
  raw: Record<string, string | undefined>,
): PurchasesParams {
  const view: PurchasesView = raw.view === "orders" ? "orders" : "purchases";
  const status: PurchaseOrderListStatus =
    raw.status === "received" || raw.status === "cancelled" ? raw.status : "open";
  const decoded = decodeCursor(raw.cursor?.trim() ? raw.cursor.trim() : undefined);

  let purchaseCursor: PurchaseListCursor | undefined;
  let orderCursor: { createdAt: string; id: string } | undefined;
  if (decoded?.k === "p" && view === "purchases") {
    const { purchasedOn, createdAt, id } = decoded;
    if (
      typeof purchasedOn === "string" &&
      typeof createdAt === "string" &&
      typeof id === "string"
    ) {
      purchaseCursor = { purchasedOn, createdAt, id };
    }
  }
  if (decoded?.k === "o" && view === "orders") {
    const { createdAt, id } = decoded;
    if (typeof createdAt === "string" && typeof id === "string") {
      orderCursor = { createdAt, id };
    }
  }

  return {
    view,
    q: raw.q?.trim() ?? "",
    seller: raw.seller?.trim() ? raw.seller.trim() : undefined,
    status,
    purchaseCursor,
    orderCursor,
  };
}

export function purchasesHref(
  params: PurchasesParams,
  extra?: { cursor?: string },
): string {
  const search = new URLSearchParams();
  if (params.view !== "purchases") search.set("view", params.view);
  if (params.q) search.set("q", params.q);
  if (params.seller) search.set("seller", params.seller);
  if (params.view === "orders" && params.status !== "open") search.set("status", params.status);
  if (extra?.cursor) search.set("cursor", extra.cursor);
  const qs = search.toString();
  return qs ? `/desk/purchases?${qs}` : "/desk/purchases";
}

/** The orders list lives on the Purchases page now; old list links land here. */
export const ORDERS_VIEW_HREF = "/desk/purchases?view=orders";
