import Link from "next/link";
import { StatusPill } from "@/components/kit";
import { formatShortDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import type { PurchaseListRow } from "@/domains/purchasing/purchases";

/** AR-6b section 5: appliance purchase rows (date, seller, count, the
 * domain receipt total, and the Tax question chip). */
export function PurchasesList({
  rows,
  nextHref,
}: {
  rows: PurchaseListRow[];
  nextHref: string | null;
}) {
  return (
    <div className="space-y-3">
      <ul
        aria-label="Appliance purchases"
        className="divide-y divide-line rounded-card border border-line bg-surface"
      >
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/desk/purchases/${p.id}`}
              className="flex flex-col gap-1 p-4 hover:bg-subtle sm:flex-row sm:items-center sm:gap-4"
            >
              <span className="font-semibold text-ink">{formatShortDate(p.purchasedOn)}</span>
              <span className="text-ink-soft">{p.supplier?.name ?? p.sellerName ?? "—"}</span>
              <span className="text-sm text-ink-soft">
                {p._count.appliances} {p._count.appliances === 1 ? "appliance" : "appliances"}
              </span>
              <span className="font-semibold text-ink sm:ml-auto">
                {formatMoney(p.receiptTotalCents)}
              </span>
              {p.hasTaxQuestion && <StatusPill tone="attention" label="Tax question" />}
            </Link>
          </li>
        ))}
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
