import Link from "next/link";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import { ButtonLink,
  DataList,
  EmptyState,
    type DataListColumn } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import { loadBillingReconciliationPageData } from "./data";
import { recordBankPaymentAction } from "./actions";

export const metadata = { title: "Billing check" };

type ReconciliationRow = Awaited<
  ReturnType<typeof loadBillingReconciliationPageData>
>["rows"][number];

export default async function BillingReconciliationPage() {
  const { checkedAt, rows, bankPayments } =
    await loadBillingReconciliationPageData();

  const columns: DataListColumn<ReconciliationRow>[] = [
    {
      key: "kind",
      header: "Kind",
      primary: true,
      cell: (row) => row.kind.replaceAll("_", " "),
    },
    {
      key: "subject",
      header: "Subject",
      cell: (row) => (
        <div>
          <p>{row.subjectType}</p>
          <p className="font-mono text-xs text-ink-faint">
            {row.subjectId}
          </p>
        </div>
      ),
    },
    {
      key: "detail",
      header: "Detail",
      cell: (row) => (
        <div>
          <span>{row.detail}</span>
          {row.kind === "HELD_PAYMENT" && (
            <>
              {" "}
              <Link
                href="/desk/billing/held-payments"
                className="font-medium text-ink underline-offset-4 hover:underline"
              >
                Decide what to do with it
              </Link>
            </>
          )}
        </div>
      ),
    },
    {
      key: "since",
      header: "Since",
      cell: (row) =>
        `${formatBusinessDate(row.since)} ${formatBusinessTime(
          row.since,
        )}`,
    },
  ];

  return (
    <div>
      <Link href="/desk/billing" className="text-sm text-ink-soft hover:underline">
        &larr; Back to billing
      </Link>

      <h1 className="mt-2 text-xl font-semibold">Billing check</h1>
      <p className="mt-1 text-sm text-ink-soft">Read-only provider and record mismatches that may need investigation. This page never repairs or retries anything.</p>

      <p className="mb-4 text-sm text-ink-soft">
        Last checked {formatBusinessDate(checkedAt)} at{" "}
        {formatBusinessTime(checkedAt)}
      </p>

      <DataList
        rows={rows}
        columns={columns}
        caption="Billing reconciliation mismatches"
        empty={
          <EmptyState
            title="No billing/provider drift detected"
            description="The bounded check did not find any mismatches that need investigation."
          />
        }
      />

      {bankPayments.length > 0 && (
        <section aria-labelledby="bank-cleared-heading" className="mt-8 space-y-3">
          <h2 id="bank-cleared-heading" className="text-lg font-semibold text-ink">Bank payments Stripe says cleared</h2>
          <p className="text-sm text-ink-soft">Not on the bill yet. Pressing twice records it once.</p>
          <ul className="divide-y divide-line rounded-control border border-line">
            {bankPayments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="text-sm">
                  {payment.customerName}
                  {payment.invoiceNumber ? ` · bill #${payment.invoiceNumber}` : ""} · {formatMoney(payment.amountCents)} · cleared{" "}
                  {formatBusinessDate(payment.since)}
                </span>
                <form action={recordBankPaymentAction}>
                  <input type="hidden" name="rowId" value={payment.id} />
                  <button type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Record it now</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
