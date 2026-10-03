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
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700">
          No billing/provider drift was detected in the bounded reconciliation scan.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Kind</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Subject</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Detail</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.subjectType}:${row.subjectId}`}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                    {row.kind.replaceAll("_", " ")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    <div>{row.subjectType}</div>
                    <div className="font-mono text-xs text-gray-500">{row.subjectId}</div>
                  </td>
                  <td className="min-w-80 px-4 py-3 text-gray-700">{row.detail}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
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
