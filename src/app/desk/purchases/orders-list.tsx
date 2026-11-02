import Link from "next/link";
import { StatusPill } from "@/components/kit";
import { formatShortDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing";
import {
  PURCHASE_ORDER_PILL,
  type PurchaseOrderPageRow,
} from "@/domains/purchasing/orders-page";

/** AR-6b section 5: parts order rows on the Purchases page's orders view
 * (supplier, pill, line count, the domain-computed known total). The same
 * row shape serves the supplier record's Orders tab. */
export function OrdersList({
  rows,
  nextHref,
}: {
  rows: PurchaseOrderPageRow[];
  nextHref: string | null;
}) {
  return (
    <div className="space-y-3">
      <ul
        aria-label="Parts orders"
        className="divide-y divide-line rounded-card border border-line bg-surface"
      >
        {rows.map((order) => {
          const pill = PURCHASE_ORDER_PILL[order.status];
          return (
            <li key={order.id}>
              <Link
                href={`/desk/purchase-orders/${order.id}`}
                className="flex flex-col gap-1 p-4 hover:bg-subtle sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="font-semibold text-ink">{order.supplierName}</span>
                <StatusPill tone={pill.tone} label={pill.label} />
                <span className="text-sm text-ink-soft">
                  {order.lineCount} {order.lineCount === 1 ? "line" : "lines"} ·{" "}
                  {formatShortDate(order.createdAt)}
                  {order.receivedAt ? ` · arrived ${formatShortDate(order.receivedAt)}` : ""}
                </span>
                <span className="font-semibold text-ink sm:ml-auto">
                  {formatCents(order.knownTotalCents)}
                  {order.unpricedLines > 0 ? ` + ${order.unpricedLines} unpriced` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {nextHref && (
        <div className="flex justify-center">
          <Link
            href={nextHref}
            className="rounded-control border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
