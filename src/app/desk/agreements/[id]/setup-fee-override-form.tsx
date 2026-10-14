"use client";
import { useActionState } from "react";
import { MoneyInput } from "@/components/ui/money";
import { saveSetupFeeOverrideAction } from "./setup-fee-override-actions";

export function SetupFeeOverrideForm({ agreementId, addressId, currentCents,
  existingReason }: { agreementId: string; addressId: string; currentCents: number;
  existingReason: string | null }) {
  const [status, action, pending] = useActionState(saveSetupFeeOverrideAction,
    { success: "", error: "" });
  return <form action={action} className="grid min-w-0 gap-2 rounded-control border border-line p-3 text-sm">
    <input type="hidden" name="agreementId" value={agreementId} />
    <input type="hidden" name="serviceAddressId" value={addressId} />
    <label className="grid min-w-0 gap-1 font-medium">
      Adjusted administrative setup fee for this delivery location
      <MoneyInput name="feeDollars" cents={currentCents}
        className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
    </label>
    <label className="grid min-w-0 gap-1 font-medium">
      Required owner reason for this exception
      <textarea name="reason" defaultValue={existingReason ?? ""} maxLength={500} rows={2}
        className="min-w-0 w-full max-w-full rounded-control border border-line p-2"
        placeholder="Why is this fee adjusted or waived?" />
    </label>
    <p className="text-xs text-ink-soft">An adjustment applies once per delivery location across all linked draft agreements. Saving invalidates prepared, unpaid charge snapshots. Signed amounts stay frozen.</p>
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={pending} className="rounded-control bg-action px-3 py-2 text-on-action disabled:opacity-50">
        Save reviewed amount
      </button>
      {existingReason && <button type="submit" name="operation" value="restore" disabled={pending}
        className="rounded-control border border-line px-3 py-2 disabled:opacity-50">Restore configured fee</button>}
    </div>
    {status.success && <p role="status" className="text-green-700">{status.success}</p>}
    {status.error && <p role="alert" className="text-red-700">{status.error}</p>}
  </form>;
}
