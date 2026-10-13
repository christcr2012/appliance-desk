"use client";

import { useActionState } from "react";
import { recordManualSigningAction } from "./manual-signing-actions";
import { formatCents } from "@/domains/pricing/money";

export function ManualSigningPaymentForm({
  agreementId, amountCents, receivedOn,
}: { agreementId: string; amountCents: number; receivedOn: string }) {
  const action = recordManualSigningAction.bind(null, agreementId);
  const [result, submitAction, pending] = useActionState(action, { success: false, message: "" });
  return (
    <form action={submitAction} className="mt-4 space-y-4 rounded-lg border border-line bg-surface p-4">
      <p className="font-semibold">Record money received at signing: {formatCents(amountCents)}</p>
      <p className="text-sm text-ink-soft">
        Only record the full signed amount after receiving real money. This is not a Stripe charge.
        A check or bank transfer is your confirmation that payment was actually received.
        The down payment is reserved for this agreement&apos;s first invoice, not other properties.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="signing-manual-method" className="block text-sm font-medium">How was it paid?</label>
          <select id="signing-manual-method" name="method" required defaultValue="check"
            className="w-full rounded border border-line bg-surface px-3 py-2">
            <option value="check">Check</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="other">Other offline payment</option>
          </select>
        </div>
        <div>
          <label htmlFor="signing-manual-date" className="block text-sm font-medium">Date received</label>
          <input id="signing-manual-date" name="receivedOn" type="date" defaultValue={receivedOn}
            required className="w-full rounded border border-line bg-surface px-3 py-2" />
        </div>
      </div>
      <div>
        <label htmlFor="signing-manual-reference" className="block text-sm font-medium">Payment reference</label>
        <input id="signing-manual-reference" name="reference" required maxLength={120}
          placeholder="Check number or transfer reference"
          className="w-full rounded border border-line bg-surface px-3 py-2" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input name="confirmedReceived" type="checkbox" value="yes" required className="mt-1" />
        <span>I verified that the full {formatCents(amountCents)} has actually been received,
          and I am recording it only for this signed agreement.</span>
      </label>
      <button type="submit" disabled={pending} className="rounded bg-action px-4 py-2 font-medium text-on-action disabled:opacity-60">
        {pending ? "Recording..." : "Record signing payment"}
      </button>
      {result.message && <p role="status" aria-live="polite" className="text-sm">{result.message}</p>}
    </form>
  );
}
