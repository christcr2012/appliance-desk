import { getRevenueDashboard } from "@/domains/billing";
import { formatCents } from "@/domains/pricing";

export const metadata = { title: "Revenue" };

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "good";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-300 bg-amber-50"
      : tone === "good"
        ? "border-gray-200 bg-primary-soft"
        : "border-gray-200 bg-white";
  const valueClass =
    tone === "good" ? "text-primary-dark" : "text-gray-900";
  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

export default async function RevenuePage() {
  const stats = await getRevenueDashboard();
  const maxTrendCents = Math.max(1, ...stats.mrrTrend.map((p) => p.mrrCents));

  return (
    <div>
      <h1 className="text-xl font-semibold">Revenue</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        How much recurring revenue you&apos;re generating and how much
        you&apos;ve actually collected. Collected amounts and past-due totals
        come straight from Stripe; monthly recurring revenue (MRR) is
        calculated from agreements that are actually being billed — a
        rental that&apos;s signed but not delivered yet doesn&apos;t count
        toward it until billing actually starts.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monthly recurring revenue (MRR)" value={formatCents(stats.mrrCents)} tone="good" />
        <Stat label="Annualized recurring revenue (ARR)" value={formatCents(stats.arrCents)} tone="good" />
        <Stat label="Collected this month" value={formatCents(stats.collectedThisMonthCents)} />
        <Stat label="Collected all-time" value={formatCents(stats.collectedAllTimeCents)} />
        <Stat label="Rentals currently billing" value={String(stats.activeRentalCount)} />
        <Stat label="Customers currently billing" value={String(stats.activeCustomerCount)} />
        <Stat label="New rentals this month" value={String(stats.newRentalsThisMonth)} />
        <Stat
          label="Ended/cancelled this month"
          value={String(stats.endedOrCancelledThisMonth)}
        />
        <Stat
          label="Past-due amount"
          value={formatCents(stats.pastDueCents)}
          tone={stats.pastDueCents > 0 ? "warning" : "default"}
        />
        <Stat
          label="Past-due invoices"
          value={String(stats.pastDueInvoiceCount)}
          tone={stats.pastDueInvoiceCount > 0 ? "warning" : "default"}
        />
        <Stat
          label="Failed payments this month"
          value={String(stats.failedPaymentsThisMonth)}
          tone={stats.failedPaymentsThisMonth > 0 ? "warning" : "default"}
        />
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">MRR, last 6 months</h2>
        <p className="mt-1 text-sm text-gray-600">
          Based on when agreements started and ended — see the note below for
          what this does and doesn&apos;t capture.
        </p>
        <div className="mt-4 flex items-end gap-3" style={{ height: 160 }}>
          {stats.mrrTrend.map((point) => (
            <div key={point.monthLabel} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-primary"
                style={{
                  height: `${Math.max(4, (point.mrrCents / maxTrendCents) * 140)}px`,
                }}
                title={formatCents(point.mrrCents)}
              />
              <span className="text-xs text-gray-500">{point.monthLabel}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-gray-500">
        MRR and the trend above are calculated from your active/past
        agreements&apos; agreed monthly pricing, not a separate ledger —
        collected revenue, past-due, and failed-payment figures above come
        directly from what Stripe has actually processed, which is always
        the exact real number.
      </p>
    </div>
  );
}
