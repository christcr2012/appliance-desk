import { requireRole } from "@/lib/session";
import { listPrivacyRequestsForOwner } from "@/domains/privacy";
import {
  fulfillPrivacyDeletionAction,
  rejectPrivacyRequestAction,
  verifyPrivacyByPhoneAction,
} from "./actions";

export const metadata = { title: "Privacy requests" };

function label(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export default async function DeskPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const session = await requireRole("OWNER");
  const [requests, params] = await Promise.all([
    listPrivacyRequestsForOwner(session.user.id),
    searchParams,
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-ink">Privacy requests</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Verify identity before fulfilling a request. Deletion removes or pseudonymizes personal data but preserves
        invoices, payments, signed agreements, document evidence, notices and audit records that the business must keep.
      </p>
      {params.updated && <p role="status" className="mt-4 rounded-lg border border-line bg-subtle p-3 text-sm text-ink">Privacy request updated.</p>}
      {params.error && <p role="alert" className="mt-4 text-sm text-red-700">That privacy action could not be completed.</p>}

      {requests.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">No privacy requests.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {requests.map((request) => (
            <section key={request.id} className="rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium text-ink">{request.kind === "EXPORT" ? "Data export" : "Deletion"}</h2>
                  <p className="mt-1 text-sm text-ink-soft">{request.requesterEmail}</p>
                  <p className="text-xs text-ink-faint">Request {request.id}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium text-ink">{label(request.status)}</p>
                  <p className="text-ink-soft">{request.createdAt.toLocaleString("en-US")}</p>
                </div>
              </div>

              {request.notes && <p className="mt-3 text-sm text-ink-soft">{request.notes}</p>}
              {request.rejectedReason && <p className="mt-2 text-sm text-red-700">Rejected: {request.rejectedReason}</p>}

              {(request.status === "RECEIVED" || request.status === "VERIFIED") && (
                <div className="mt-4 space-y-3 border-t border-line pt-4">
                  {request.status === "RECEIVED" && request.customerId && (
                    <form action={verifyPrivacyByPhoneAction}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <button type="submit" className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
                        I verified this person by phone
                      </button>
                    </form>
                  )}

                  {request.status === "VERIFIED" && request.kind === "EXPORT" && (
                    <a href={`/api/privacy/export/${request.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
                      Download customer data JSON
                    </a>
                  )}

                  {request.status === "VERIFIED" && request.kind === "DELETE" && (
                    <form action={fulfillPrivacyDeletionAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="requestId" value={request.id} />
                      <label className="text-sm font-medium text-ink">
                        Type DELETE to confirm
                        <input name="confirmation" required className="mt-1 block min-h-11 rounded-lg border border-control bg-surface px-3 py-2" />
                      </label>
                      <button type="submit" className="min-h-11 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                        Pseudonymize personal data
                      </button>
                    </form>
                  )}

                  <form action={rejectPrivacyRequestAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="requestId" value={request.id} />
                    <label className="min-w-64 flex-1 text-sm font-medium text-ink">
                      Rejection reason
                      <input name="reason" required minLength={3} className="mt-1 block min-h-11 w-full rounded-lg border border-control bg-surface px-3 py-2" />
                    </label>
                    <button type="submit" className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
                      Reject request
                    </button>
                  </form>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
