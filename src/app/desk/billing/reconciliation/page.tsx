import Link from "next/link";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { PageHeader } from "@/components/desk/workspace";
import { loadBillingReconciliationPageData } from "./data";

export const metadata = { title: "Billing reconciliation" };

export default async function BillingReconciliationPage() {
  const { checkedAt, rows } = await loadBillingReconciliationPageData();

  return (
    <div>
      <PageHeader
        title="Billing reconciliation"
        description="Read-only provider and ledger mismatches that may need investigation. This page never repairs or retries anything."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
        <p>
          Last checked {formatBusinessDate(checkedAt)} at {formatBusinessTime(checkedAt)}
        </p>
        <Link href="/desk/billing" className="font-medium text-brand hover:underline">
          Back to billing
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-white p-6 text-sm text-ink-soft">
          No billing/provider drift was detected in the bounded reconciliation scan.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-soft">Kind</th>
                <th className="px-4 py-2 text-left font-medium text-ink-soft">Subject</th>
                <th className="px-4 py-2 text-left font-medium text-ink-soft">Detail</th>
                <th className="px-4 py-2 text-left font-medium text-ink-soft">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.subjectType}:${row.subjectId}`}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                    {row.kind.replaceAll("_", " ")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    <div>{row.subjectType}</div>
                    <div className="font-mono text-xs text-ink-faint">{row.subjectId}</div>
                  </td>
                  <td className="min-w-80 px-4 py-3 text-ink-soft">
                    {row.detail}
                    {row.kind === "HELD_PAYMENT" && (
                      <>
                        {" "}
                        <Link href="/desk/billing/held-payments" className="font-medium text-brand hover:underline">
                          Decide what to do with it
                        </Link>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatBusinessDate(row.since)} {formatBusinessTime(row.since)}
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
