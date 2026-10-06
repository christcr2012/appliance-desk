import Link from "next/link";
import { getRevenueRecords } from "@/domains/billing/revenue-records";
import { FilterBar } from "@/components/desk/workspace";
import {
  ButtonLink,
  Card,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { MetricStat } from "@/components/desk/metric-stat";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import { getRevenueDashboard } from "@/domains/billing";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Revenue" };

type RevenueRow = Awaited<
  ReturnType<typeof getRevenueRecords>
>["rows"][number];

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    scope?: string;
    page?: string;
  }>;
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
    return `/desk/revenue?${new URLSearchParams({
      source: nextSource,
      scope: nextMonthOnly ? "month" : "all",
      page: String(page),
    })}`;
  }

  const maxTrendCents = Math.max(
    1,
    ...stats.mrrTrend.map((point) => point.mrrCents),
  );

  const columns: DataListColumn<RevenueRow>[] = [
    {
      key: "customer",
      header: "Customer",
      primary: true,
      cell: (row) => (
        <div>
          <Link
            href={`/desk/billing/customer/${row.customerId}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {row.customerName}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {row.invoices.length === 0
              ? "Not applied to an invoice"
              : row.invoices.map((invoice, index) => (
                  <span key={invoice.id}>
                    {index > 0 && ", "}
                    <Link
                      className="font-medium text-ink underline-offset-4 hover:underline"
                      href={`/desk/billing/customer/${row.customerId}/invoice/${invoice.id}`}
                    >
                      Invoice #{invoice.invoiceNumber}
                    </Link>
                  </span>
                ))}
          </p>
          {row.unallocatedCents > 0 && (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {formatCents(row.unallocatedCents)} held as account credit
            </p>
          )}
          {row.heldCents > 0 && (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {formatCents(row.heldCents)} held for your decision{" "}
              <Link
                href="/desk/billing/held-payments"
                className="font-medium text-ink underline-offset-4 hover:underline"
              >
                Decide
              </Link>
            </p>
          )}
        </div>
      ),
    },
    {
      key: "basis",
      header: "Basis",
      cell: (row) => (
        <span>
          {row.basis}
          {row.method ? ` · ${row.method}` : ""}
        </span>
      ),
    },
    {
      key: "date",
      header: "Recorded",
      cell: (row) =>
        `${formatBusinessDate(row.createdAt)} · ${formatBusinessTime(
          row.createdAt,
        )}`,
    },
    {
      key: "amount",
      header: "Amount",
      cell: (row) => (
        <span className="font-semibold text-ink">
          {formatCents(row.amountCents)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Revenue and cash activity"
        description="Agreed rental rates, real cash receipts, invoice allocations and refunds are tracked separately so the numbers keep their meaning."
        secondaryActions={
          <ButtonLink href="/desk/billing" variant="secondary">
            Review invoices and statements
          </ButtonLink>
        }
      />

      <p className="text-sm text-ink-soft">
        As of {formatBusinessDate(asOf)} · {formatBusinessTime(asOf)}. Cash
        figures and the list below use each receipt&apos;s actual received date,
        and “this month” is the Colorado calendar month. The monthly-rate trend
        still groups by UTC month. No costs are deducted, so this report cannot
        establish profit.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricStat
          metric="revenue.mrr"
          value={formatCents(stats.mrrCents)}
          tone="good"
        />
        <MetricStat
          metric="revenue.arr"
          value={formatCents(stats.arrCents)}
          tone="good"
        />
        <MetricStat
          metric="revenue.cashMonth"
          value={formatCents(stats.collectedThisMonthCents)}
        />
        <MetricStat
          metric="revenue.cashAllTime"
          value={formatCents(stats.collectedAllTimeCents)}
        />
        <MetricStat
          metric="revenue.activeRentals"
          value={String(stats.activeRentalCount)}
        />
        <MetricStat
          metric="revenue.activeCustomers"
          value={String(stats.activeCustomerCount)}
        />
        <MetricStat
          metric="revenue.newRentals"
          value={String(stats.newRentalsThisMonth)}
        />
        <MetricStat
          metric="revenue.closedRentals"
          value={String(stats.endedOrCancelledThisMonth)}
        />
        <MetricStat
          metric="revenue.pastDueAmount"
          value={formatCents(stats.pastDueCents)}
          tone={stats.pastDueCents > 0 ? "warning" : "default"}
        />
        <MetricStat
          metric="revenue.pastDueCount"
          value={String(stats.pastDueInvoiceCount)}
          tone={stats.pastDueInvoiceCount > 0 ? "warning" : "default"}
        />
        <MetricStat
          metric="revenue.failedPayments"
          value={String(stats.failedPaymentsThisMonth)}
          tone={
            stats.failedPaymentsThisMonth > 0 ? "warning" : "default"
          }
        />
      </div>

      <div className="mt-8">
        <Card
          title="Estimated agreed rates, last 6 UTC months"
          description="Sum of agreed monthly line rates for rentals whose billing period overlaps each month. A mid-month rental contributes its full rate; this is not invoiced rent or cash received."
        >
          {stats.mrrTrend.some((point) => point.mrrCents > 0) ? (
            <div
              aria-hidden="true"
              className="flex h-40 items-end gap-3"
            >
              {stats.mrrTrend.map((point) => (
                <div
                  key={point.monthLabel}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <div
                    className="w-full rounded-t bg-action"
                    style={{
                      height: `${Math.max(
                        0,
                        (point.mrrCents / maxTrendCents) * 140,
                      )}px`,
                    }}
                    title={formatCents(point.mrrCents)}
                  />
                  <span className="text-xs text-ink-faint">
                    {point.monthLabel}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No positive monthly rates recorded"
              description="The six-month trend will appear once agreements contribute positive monthly rates."
            />
          )}
        </Card>
      </div>

      <p className="mt-4 max-w-2xl text-sm text-ink-soft">
        Current MRR sums line prices on ACTIVE rentals with billing started;
        ARR is MRR × 12. Gross cash received comes from Receipt records, so
        one combined check is counted once even when it pays several invoices,
        and any unallocated overpayment is still part of the cash received.
        Refunds are shown separately. Past-due balances use recorded
        OPEN/PARTIALLY_PAID/DELINQUENT invoices with a past due date and
        subtract recorded paid allocations. Closed-rental counts use last
        update time, which may differ from the actual closure date.
      </p>

      <div className="mt-6">
        <Card
          title="Monthly rate values"
          description="Estimated agreement rates for each UTC month."
        >
          <dl className="grid gap-3 sm:grid-cols-3">
            {stats.mrrTrend.map((point) => (
              <div key={point.monthLabel}>
                <dt className="text-sm font-semibold text-ink-soft">
                  {point.monthLabel}
                </dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatCents(point.mrrCents)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-6">
        <FilterBar
          label="Invoice ledger source"
          items={[
            {
              label: "Cash received",
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
          label="Invoice ledger period"
          items={[
            {
              label: "This month (Colorado)",
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

        <Card
          title={
            source === "payments"
              ? "Cash received (one row per payment)"
              : "Recorded invoice refunds"
          }
          description={`${records.meta.totalCount} matching records · ${formatCents(
            records.totalCents,
          )} total${
            source === "refunds" && records.toCreditCents > 0
              ? ` (${formatCents(
                  records.toCreditCents,
                )} kept as account credit, so no cash left)`
              : ""
          } · newest first. All totals include records beyond this page.`}
        >
          <p className="mb-4 text-sm text-ink-soft">
            Each payment appears once, even when one check paid several
            invoices, and any amount not applied to an invoice is shown as
            account credit. Refunds use the refund record date, not the
            original payment date. Security-deposit refunds have their own
            deposit records and are not included here. Unpaid, pending, and
            failed payment attempts do not count as successful allocations.
          </p>

          <DataList
            rows={records.rows}
            columns={columns}
            caption={
              source === "payments"
                ? "Cash received"
                : "Recorded invoice refunds"
            }
            empty={
              <EmptyState
                title="No matching records"
                description="Choose another source or period to review different cash activity."
              />
            }
          />

          <Pagination {...records.meta} buildHref={recordsHref} />
        </Card>
      </div>
    </div>
  );
}
