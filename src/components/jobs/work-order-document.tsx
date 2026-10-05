import Image from "next/image";
import type { WorkOrderDetail } from "@/domains/jobs/work-order-detail";
import { safeLogoUrl } from "@/domains/settings/profile-extras";
import { jobStatusLabel, jobTypeLabel } from "@/lib/status-labels";
import { CalendarServiceIcon } from "@/components/icons/service-icons";

// A single work order laid out like a real field-service document —
// matching the brand kit's own Work-order.pdf template the same way
// invoice-document.tsx matches Invoice.pdf (2026-09-29, see
// docs/DECISIONS.md). Same plain Tailwind gray/white classes and
// print:* treatment as the invoice document — see that file's own
// comment for why (the short version: those classes are what actually
// prints correctly, since dark-mode CSS variables don't survive to
// paper).

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-200 text-gray-700",
};

function formatDateTime(date: Date | null): string {
  return date
    ? new Date(date).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not yet scheduled";
}

export function WorkOrderDocument({ job }: { job: WorkOrderDetail }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white print:rounded-none print:border-0 print:text-black">
      <div className="flex flex-wrap items-start justify-between gap-4 bg-gray-900 px-6 py-6 text-white print:bg-white print:px-0 print:pt-0 print:text-black">
        <div>
          {safeLogoUrl(job.business.logoUrl) && (
            <Image
              src={safeLogoUrl(job.business.logoUrl)!}
              alt={job.business.name}
              width={160}
              height={40}
              className="mb-2 h-10 w-auto rounded bg-white p-1 print:p-0"
            />
          )}
          <p className="text-lg font-semibold">{job.business.name}</p>
          <p className="mt-1 whitespace-pre-line text-sm opacity-90 print:opacity-100">{job.business.address}</p>
          <p className="text-sm opacity-90 print:opacity-100">
            {job.business.phone} · {job.business.email}
          </p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-2 text-xl font-semibold tracking-wide">
            <CalendarServiceIcon className="h-5 w-5 text-white print:text-black" />
            WORK ORDER
          </p>
          <p className="mt-1 font-mono text-sm opacity-90 print:opacity-100">{jobTypeLabel(job.type)}</p>
          <p className="mt-2 text-sm opacity-90 print:opacity-100">Scheduled {formatDateTime(job.scheduledAt)}</p>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Customer</p>
            {job.customer ? (
              <>
                <p className="mt-1 font-medium text-gray-900">{job.customer.name}</p>
                {job.customer.phone && <p className="text-sm text-gray-600">{job.customer.phone}</p>}
                <p className="text-sm text-gray-600">{job.customer.email}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-gray-600">No customer on file for this visit</p>
            )}
            {job.address && <p className="mt-1 text-sm text-gray-600">{job.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
            <span
              className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-medium ${
                STATUS_STYLES[job.status] ?? "bg-gray-100 text-gray-700"
              }`}
            >
              {jobStatusLabel(job.status)}
            </span>
            {job.completedAt && (
              <p className="mt-2 text-sm text-gray-600">Completed {formatDateTime(job.completedAt)}</p>
            )}
          </div>
        </div>

        {job.appliances.length > 0 && (
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="py-2">Appliance</th>
                <th className="py-2 text-right">Asset #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {job.appliances.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5 text-gray-900">{a.applianceType}</td>
                  <td className="py-2.5 text-right font-mono text-gray-600">{a.assetNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {job.checklist.length > 0 && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Checklist</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {job.checklist.map((item, index) => (
                <li key={index} className="flex items-center gap-2 text-gray-700">
                  <span
                    className={`inline-block h-4 w-4 flex-none rounded border ${
                      item.checked ? "border-green-600 bg-green-600" : "border-gray-300"
                    }`}
                    aria-hidden="true"
                  />
                  <span className={item.checked ? "text-gray-500 line-through" : ""}>{item.item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {job.notes && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{job.notes}</p>
          </div>
        )}

        {job.completionNotes && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Completion notes</p>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{job.completionNotes}</p>
          </div>
        )}

        <p className="mt-8 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          {job.business.name} · {job.business.phone} · {job.business.email}
        </p>
      </div>
    </div>
  );
}
