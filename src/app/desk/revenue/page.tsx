import Link from "next/link";
import { getRevenueRecords } from "@/domains/billing/revenue-records";
import {
  PageHeader,
  SectionCard,
  FilterBar,
} from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getRevenueDashboard } from "@/domains/billing";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";

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
  const valueClass = tone === "good" ? "text-primary-dark" : "text-gray-900";
  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

// OWNER/ADMIN only (docs/DECISIONS.md, 2026-09-28 "Staff permissions
// framework") — never rely on the nav link being hidden alone.
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; scope?: string; page?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const query = await searchParams;
  const source = query.source === "refunds" ? "refunds" : "payments";
  const monthOnly = query.scope !== "all";
  const asOf = new Date();
  const [stats, records] = await Promise.all([
    getRevenueDashboard(asOf),
    getRevenueRecords(source, monthOnly, query.page, asOf),
  ]);
  function recordsHref(
    page = 1,
    nextSource = source,
    nextMonthOnly = monthOnly,
  ) {
    return `/desk/revenue?${new URLSearchParams({ source: nextSource, scope: nextMonthOnly ? "month" : "all", page: String(page) })}`;
  }
  const maxTrendCents = Math.max(1, ...stats.mrrTrend.map((p) => p.mrrCents));

  return (
    <div>
      <PageHeader
        title="Revenue and recorded payments"
        description="Agreed rental rates, gross invoice payments and recorded refunds have different meanings."
        secondaryActions={
          <Link
            className="min-h-11 inline-flex items-center text-primary underline"
            href="/desk/billing"
          >
            Review invoices and statements
          </Link>
        }
      />
      <p className="text-sm text-ink-soft">
        As of {formatBusinessDate(asOf)} · {formatBusinessTime(asOf)}. Monthly
        figures and trend use UTC calendar months. Payments use their recorded
        creation time; provider settlement dates may differ. No costs are
        deducted, so this report cannot establish profit.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Estimated monthly rate (MRR)"
          value={formatCents(stats.mrrCents)}
          tone="good"
        />
        <Stat
          label="Estimated annual rate (ARR)"
          value={formatCents(stats.arrCents)}
          tone="good"
        />
        <Stat
          label="Gross invoice payments this month"
          value={formatCents(stats.collectedThisMonthCents)}
        />
        <Stat
          label="Gross invoice payments all-time"
          value={formatCents(stats.collectedAllTimeCents)}
        />
        <Stat
          label="Rentals currently billing"
          value={String(stats.activeRentalCount)}
        />
        <Stat
          label="Customers currently billing"
          value={String(stats.activeCustomerCount)}
        />
        <Stat
          label="Rental starts dated this month"
          value={String(stats.newRentalsThisMonth)}
        />
        <Stat
          label="Closed rentals updated this month"
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
        <h2 className="font-medium text-gray-900">
          Estimated agreed rates, last 6 UTC months
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Sum of agreed monthly line rates for rentals whose billing period
          overlaps each month. A mid-month rental contributes its full rate;
          this is not invoiced rent or cash received.
        </p>
        {/* h-40 = 160px — a static value, so a plain Tailwind class
            instead of an inline `style` (2026-09-29, alongside the new
            Content-Security-Policy header — every avoidable inline
            style keeps that policy stricter). The bars below stay
            inline since their height is computed per data point. */}
        {stats.mrrTrend.some((point) => point.mrrCents > 0) ? (
          <div aria-hidden="true" className="mt-4 flex h-40 items-end gap-3">
            {stats.mrrTrend.map((point) => (
              <div
                key={point.monthLabel}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <div
                  className="w-full rounded-t bg-primary"
                  style={{
                    height: `${Math.max(0, (point.mrrCents / maxTrendCents) * 140)}px`,
                  }}
                  title={formatCents(point.mrrCents)}
                />
                <span className="text-xs text-gray-500">
                  {point.monthLabel}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-subtle p-4 text-sm text-ink-soft">
            No positive monthly rates recorded in this period.
          </p>
        )}
      </div>

      <p className="mt-4 max-w-2xl text-sm text-ink-soft">
        Current MRR sums line prices on ACTIVE rentals with billing started; ARR
        is MRR × 12. Gross payments include provider-reported and owner-recorded
        payments marked succeeded, including any deposit, fees and tax on their
        invoices. Refunds are shown separately; gross payments are not net cash
        or rental revenue. Past-due balances use recorded
        OPEN/PARTIALLY_PAID/DELINQUENT invoices with a past due date and
        subtract recorded paid amounts. Closed-rental counts use last update
        time, which may differ from the actual closure date.
      </p>
      <SectionCard
        title="Monthly rate values"
        description="Estimated agreement rates for each UTC month."
      >
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {stats.mrrTrend.map((point) => (
            <div key={point.monthLabel}>
              <dt>{point.monthLabel}</dt>
              <dd>{formatCents(point.mrrCents)}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>
      <div className="mt-6">
        <FilterBar
          label="Payment report source"
          items={[
            {
              label: "Gross payments",
              href: recordsHref(1, "payments"),
              active: source === "payments",
            },
            {
              label: "Invoice refunds",
              href: recordsHref(1, "refunds"),
              active: source === "refunds",
            },
          ]}
        />
        <FilterBar
          label="Payment report period"
          items={[
            {
              label: "This UTC month",
              href: recordsHref(1, source, true),
              active: monthOnly,
            },
            {
              label: "All recorded dates",
              href: recordsHref(1, source, false),
              active: !monthOnly,
            },
          ]}
        />
        <SectionCard
          title={
            source === "payments"
              ? "Recorded gross invoice payments"
              : "Recorded invoice refunds"
          }
          description={`${records.meta.totalCount} matching records · ${formatCents(records.totalCents)} total · newest first. All totals include records beyond this page.`}
        >
          <p className="mb-4 text-sm text-ink-soft">
            Refunds use the refund record date, not the original payment date.
            Security-deposit refunds have their own deposit records and are not
            included here. Unpaid, pending and failed payment attempts do not
            count as gross payments.
          </p>
          {records.rows.length === 0 ? (
            <p>No matching records.</p>
          ) : (
            <ul className="divide-y divide-line">
              {records.rows.map((row) => (
                <li
                  key={row.id}
                  className="py-4 sm:flex sm:items-start sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <Link
                      className="break-words text-primary underline"
                      href={`/desk/billing/customer/${row.invoice.customerId}/invoice/${row.invoice.id}`}
                    >
                      Invoice #{row.invoice.invoiceNumber} ·{" "}
                      {row.invoice.customer.user.name ??
                        row.invoice.customer.user.email}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {row.basis} · {formatBusinessDate(row.createdAt)} ·{" "}
                      {formatBusinessTime(row.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 shrink-0 font-semibold sm:mt-0">
                    {formatCents(row.amountCents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Pagination {...records.meta} buildHref={recordsHref} />
        </SectionCard>
      </div>
    </div>
  );
}
