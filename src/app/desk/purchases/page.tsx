import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getPurchaseOrdersPage, getSuppliers } from "@/domains/purchasing";
import { listPurchases, type PurchaseListOptions } from "@/domains/purchasing/purchases";
import type { PurchaseOrderPageParams } from "@/domains/purchasing/orders-page";
import { EmptyState } from "@/components/ui";
import { ScreenHeader, StatusTabs, Toolbar, type FilterDef } from "@/components/kit";
import { BudgetContextCard } from "@/domains/budget/context";
import {
  ORDER_STATUS_TABS,
  PURCHASES_VIEWS,
  encodeOrderCursor,
  encodePurchaseCursor,
  parsePurchasesParams,
  purchasesHref,
} from "./params";
import { PurchasesList } from "./purchases-list";
import { OrdersList } from "./orders-list";

export const metadata = { title: "Purchases" };

/**
 * AR-6b section 5: one Purchases page, two views — appliance purchases
 * (default) and parts orders. Both lists are cursor-paged domain reads;
 * /desk/purchase-orders redirects here with ?view=orders.
 */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const raw = await searchParams;
  // Stale ?open= links (the old tables' side-panel convention) go straight
  // to the record, as before.
  if (raw.open) {
    redirect(
      raw.view === "orders"
        ? `/desk/purchase-orders/${encodeURIComponent(raw.open)}`
        : `/desk/purchases/${encodeURIComponent(raw.open)}`,
    );
  }
  const params = parsePurchasesParams(raw);
  const suppliers = await getSuppliers();
  const sellerFilter: FilterDef = {
    kind: "select",
    param: "seller",
    label: "Seller",
    options: suppliers.map((s) => ({ value: s.id, label: s.name })),
  };
  const isOrders = params.view === "orders";

  return (
    <div>
      <ScreenHeader
        title="Purchases"
        list
        primary={
          isOrders
            ? { kind: "link", label: "New order", href: "/desk/purchase-orders/new" }
            : { kind: "link", label: "Record a purchase", href: "/desk/purchases/new" }
        }
        overflow={[
          { kind: "link", label: "Audit pack", href: "/desk/sales-tax/audit-pack" },
          ...(session.user.role === "OWNER"
            ? [{ kind: "link", label: "Record keeping", href: "/desk/sales-tax/record-retention" } as const]
            : []),
        ]}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        {isOrders
          ? "Parts and supplies you've ordered, and whether they've arrived."
          : "Every receipt for appliances you bought, with its seller, tax and the appliances it covers."}
      </p>

      <div className="mb-4">
        <StatusTabs
          label="Purchases views"
          param="view"
          current={params.view}
          items={PURCHASES_VIEWS.map((v) => ({ value: v.value, label: v.label }))}
        />
      </div>

      {!isOrders && (
        <>
          <BudgetContextCard userId={session.user.id} heading="Purchase commitments and replacement reserves" />
          <Toolbar
            search={{ param: "q", placeholder: "Seller or receipt reference", label: "Search purchases" }}
            filters={[sellerFilter]}
          />
          <PurchasesView
            seller={params.seller}
            q={params.q}
            cursor={params.purchaseCursor}
            hrefFor={(cursor) => purchasesHref(params, { cursor })}
          />
        </>
      )}

      {isOrders && (
        <>
          <div className="mb-4">
            <StatusTabs
              label="Filter orders by status"
              param="status"
              current={params.status}
              items={ORDER_STATUS_TABS.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          <Toolbar filters={[sellerFilter]} />
          <OrdersView
            seller={params.seller}
            status={params.status}
            cursor={params.orderCursor}
            hrefFor={(cursor) => purchasesHref(params, { cursor })}
          />
        </>
      )}
    </div>
  );
}

async function PurchasesView({
  seller,
  q,
  cursor,
  hrefFor,
}: {
  seller?: string;
  q: string;
  cursor?: PurchaseListOptions["cursor"];
  hrefFor: (cursor: string) => string;
}) {
  const list = await listPurchases({ supplierId: seller, q, cursor });
  if (list.rows.length === 0) {
    return seller || q ? (
      <EmptyState title="No purchases here" description="Nothing matches that search or seller. Clear them to see every purchase." />
    ) : (
      <EmptyState title="No purchases yet" description="Record a purchase when you buy appliances; it replaces adding appliances one at a time." />
    );
  }
  return (
    <PurchasesList
      rows={list.rows}
      nextHref={list.nextCursor ? hrefFor(encodePurchaseCursor(list.nextCursor)) : null}
    />
  );
}

async function OrdersView({
  seller,
  status,
  cursor,
  hrefFor,
}: {
  seller?: string;
  status: PurchaseOrderPageParams["status"];
  cursor?: PurchaseOrderPageParams["cursor"];
  hrefFor: (cursor: string) => string;
}) {
  const list = await getPurchaseOrdersPage({ supplierId: seller, status, cursor });
  if (list.rows.length === 0) {
    return seller ? (
      <EmptyState title="No orders here" description="No orders from that seller in this state. Clear the seller to see every order." />
    ) : (
      <EmptyState title="No purchase orders yet" description="Start an order when you are ready to buy from a supplier." />
    );
  }
  return (
    <OrdersList
      rows={list.rows}
      nextHref={list.nextCursor ? hrefFor(encodeOrderCursor(list.nextCursor)) : null}
    />
  );
}
