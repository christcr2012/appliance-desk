import { waiveLateReturnAction } from "../actions";
import { formatCents } from "@/domains/pricing/money";
import type { getLateReturnWaiverState } from "@/domains/billing/late-return-waiver";

type State = Awaited<ReturnType<typeof getLateReturnWaiverState>>;

/** Owner/admin: who caused a late pickup? The customer pays the late days by default; "us" waives them. */
export function LateReturnWaiverForm({ jobId, state }: { jobId: string; state: State }) {
  if (state.kind === "NONE") return null;
  if (state.kind === "WAIVED") {
    return (
      <p className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900">
        The late days on this pickup were waived because the delay was ours ({formatCents(state.waivedCents)} taken off).
      </p>
    );
  }
  if (state.kind === "BLOCKED") {
    return <p className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900">{state.reason}</p>;
  }
  return (
    <form action={waiveLateReturnAction} className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium text-gray-900">Who caused the delay?</h2>
      <p className="mt-1 text-sm text-gray-700">
        This pickup was after the last paid day, so the customer was charged for the late days ({formatCents(state.chargedCents)}).
        That stands unless the delay was ours. If it was, waive the days: the charge stays visible on the invoice with a matching
        credit line, and the tax comes off too. It cannot be undone once a payment is made.
      </p>
      <input type="hidden" name="jobId" value={jobId} />
      <label htmlFor="waivedDays" className="mt-3 block text-sm font-medium text-gray-900">
        Days to waive (leave empty for all {state.maxDays})
      </label>
      <input id="waivedDays" name="waivedDays" inputMode="numeric" className="mt-1 min-h-11 w-28 rounded-lg border border-control px-3" />
      <label htmlFor="waiverNote" className="mt-3 block text-sm font-medium text-gray-900">
        Why (5 to 500 characters)
      </label>
      <input id="waiverNote" name="note" required minLength={5} maxLength={500} className="mt-1 min-h-11 w-full rounded-lg border border-control px-3" />
      <button type="submit" className="mt-4 min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle">
        The delay was ours: waive the late days
      </button>
    </form>
  );
}
