import Link from "next/link";
import { formatCents } from "@/domains/pricing";
import { DEPOSIT_BUCKET_LABEL, getDepositLiability, type DepositAgeBucket } from "@/domains/billing/deposit-liability";

/** Deposits held and still owed a decision, by how long since the rental ended. Read-only; decisions are on each row. */
export async function DepositsTab() {
  const liability = await getDepositLiability();
  const order: DepositAgeBucket[] = ["OVER_90", "DAYS_31_90", "DAYS_0_30", "STILL_RENTING"];
  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-ink-soft">
        A deposit is money you are holding that belongs to the customer until you decide how much to give back. It is
        never counted as rent or income. A deposit leaves this list when you record a decision. Age counts days since the
        rental ended (Colorado dates).
      </p>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {order.map((b) => (
          <div key={b} className={`rounded-lg border p-4 ${b === "OVER_90" && liability.byBucket[b].count > 0 ? "border-amber-500 bg-amber-50" : "border-line bg-white"}`}>
            <dt className="text-sm text-ink-soft">{DEPOSIT_BUCKET_LABEL[b]}</dt>
            <dd className="mt-1 text-xl font-semibold text-ink">{formatCents(liability.byBucket[b].cents)}</dd>
            <dd className="text-xs text-ink-soft">{liability.byBucket[b].count} deposit(s)</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm font-medium text-ink">
        Total waiting for a decision: {formatCents(liability.totalCents)} across {liability.count} deposit(s).
      </p>
      {liability.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No deposits are waiting for a decision.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full divide-y divide-line text-sm">
            <caption className="sr-only">Deposits waiting for a decision</caption>
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium text-ink-soft">Customer</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-ink-soft">Where it stands</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-ink-soft">Deposit</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-ink-soft">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {liability.rows.map((r) => (
                <tr key={r.depositId}>
                  <td className="px-4 py-2">
                    <Link className="text-ink underline" href={`/desk/customers/${r.customerId}`}>
                      {r.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {DEPOSIT_BUCKET_LABEL[r.bucket]}
                    {r.daysSinceEnd !== null ? ` (${r.daysSinceEnd} days)` : ""}
                    {r.overdue && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Over 90 days</span>}
                  </td>
                  <td className="px-4 py-2 text-right">{formatCents(r.amountCents)}</td>
                  <td className="px-4 py-2">
                    <Link className="text-primary underline" href={`/desk/billing/deposits/${r.depositId}`}>
                      Decide
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
