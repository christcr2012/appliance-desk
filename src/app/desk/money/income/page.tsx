// AR-9 (INSIGHTS section 6): Money › Income details — the old Revenue
// ledger rebuilt as a kit work queue. The read is getRevenueRecords; its
// page param stays a page number, as today, and it gained an optional
// customer search for this page's Toolbar.
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import { getRevenueRecords } from "@/domains/billing/revenue-records";
import { DataTable, ScreenHeader, StatusTabs, Toolbar, type Column } from "@/components/kit";
import { MetricHelp } from "@/components/desk/metric-stat";

export const metadata = { title: "Income details" };

type IncomeRow = Awaited<ReturnType<typeof getRevenueRecords>>["rows"][number];

export default async function MoneyIncomePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; scope?: string; page?: string; q?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const source = params.source === "refunds" ? "refunds" : "payments";
  const monthOnly = params.scope !== "all";
  const now = new Date();
  const records = await getRevenueRecords(source, monthOnly, params.page, now, params.q);

  const columns: Column<IncomeRow>[] = [
    {
      key: "customer", header: "Customer",
      cell: (r) => (
        <div>
          <Link href={`/desk/billing/customer/${r.customerId}`} className="font-bold text-ink hover:underline">
            {r.customerName}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {r.invoices.length === 0
              ? "Not applied to an invoice"
              : r.invoices.map((invoice, index) => (
                  <span key={invoice.id}>
                    {index > 0 && ", "}
                    <Link
                      className="font-medium text-ink underline-offset-4 hover:underline"
                      href={`/desk/billing/customer/${r.customerId}/invoice/${invoice.id}`}
                    >
                      Invoice #{invoice.invoiceNumber}
                    </Link>
                  </span>
                ))}
          </p>
          {r.unallocatedCents > 0 ? (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {formatMoney(r.unallocatedCents)} held as account credit
            </p>
          ) : null}
          {r.heldCents > 0 ? (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {formatMoney(r.heldCents)} held for your decision{" "}
              <Link href="/desk/billing/held-payments" className="font-medium text-ink underline-offset-4 hover:underline">
                Decide
              </Link>
            </p>
          ) : null}
        </div>
      ),
    },
    { key: "date", header: "Date", cell: (r) => formatShortDate(r.createdAt, now) },
    { key: "basis", header: "Basis", cell: (r) => (r.method ? `${r.basis} · ${r.method}` : r.basis) },
    { key: "amount", header: "Amount", cell: (r) => formatMoney(r.amountCents) },
  ];

  const pageHref = (page: number) =>
    `/desk/money/income?${new URLSearchParams({ source, scope: monthOnly ? "month" : "all", page: String(page) })}`;

  return (
    <div className="flex flex-col gap-5 px-1 sm:px-0">
      <ScreenHeader title="Money" />
      <p className="max-w-2xl text-sm text-ink-soft">
        Income details show the money actually received, and refunds. They are shown separately.
        Gross cash received comes from Receipt records, so one combined check is counted once even
        when it pays several invoices, and any unallocated overpayment is still part of the cash received.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <StatusTabs
          label="Income kind"
          param="source"
          current={source}
          items={[
            { value: "payments", label: "Money received" },
            { value: "refunds", label: "Refunds" },
          ]}
        />
        <StatusTabs
          label="When"
          param="scope"
          current={monthOnly ? "month" : "all"}
          items={[
            { value: "month", label: "This month" },
            { value: "all", label: "All dates" },
          ]}
        />
      </div>
      <Toolbar search={{ param: "q", placeholder: "Name or email", label: "Search income" }} />
      <p className="text-sm text-ink-soft">
        {records.meta.totalCount} matching records · {formatMoney(records.totalCents)} total
        {source === "refunds" && records.toCreditCents > 0
          ? ` (${formatMoney(records.toCreditCents)} kept as account credit)`
          : ""}{" "}
        · newest first.
      </p>
      {source === "payments" && monthOnly ? <MetricHelp metric="revenue.cashMonth" /> : null}
      {records.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">{source === "refunds" ? "No refunds in this period." : "No money received in this period."}</p>
      ) : (
        <DataTable
          caption="Income details"
          rows={records.rows}
          rowKey={(r) => r.id}
          columns={columns}
          rowHref={(r) => r.invoices[0]
            ? `/desk/billing/customer/${r.customerId}/invoice/${r.invoices[0].id}`
            : `/desk/billing/customer/${r.customerId}`}
          mobileCard={(r) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <span className="font-bold text-ink">{r.customerName}</span>
                <span className="font-extrabold text-ink tabular-nums">{formatMoney(r.amountCents)}</span>
              </div>
              <p className="text-sm text-ink-soft">
                {formatShortDate(r.createdAt, now)} · {r.method ? `${r.basis} · ${r.method}` : r.basis}
              </p>
              {r.unallocatedCents > 0 ? (
                <p className="text-sm text-ink-soft">{formatMoney(r.unallocatedCents)} held as account credit</p>
              ) : null}
              {r.heldCents > 0 ? (
                <p className="text-sm text-ink-soft">{formatMoney(r.heldCents)} held for your decision</p>
              ) : null}
            </div>
          )}
          empty={<p className="text-sm text-ink-soft">No records.</p>}
        />
      )}
      {records.meta.totalPages > 1 ? (
        <div className="flex items-center gap-3 text-sm">
          {records.meta.page > 1 ? (
            <Link href={pageHref(records.meta.page - 1)} className="font-bold text-primary hover:underline">Previous</Link>
          ) : null}
          <span>Page {records.meta.page} of {records.meta.totalPages}</span>
          {records.meta.page < records.meta.totalPages ? (
            <Link href={pageHref(records.meta.page + 1)} className="font-bold text-primary hover:underline">Next</Link>
          ) : null}
        </div>
      ) : null}
      <p className="max-w-2xl text-sm text-ink-soft">
        Each payment appears once, even when one check paid several invoices, and any amount not
        applied to an invoice is shown as account credit. Refunds use the refund record date, not
        the original payment date. Security-deposit refunds have their own deposit records and are
        not included here. Unpaid, pending, and failed payment attempts do not count as successful
        allocations.
      </p>
    </div>
  );
}
