"use client";
import { useActionState } from "react";
import { MoneyInput } from "@/components/ui/money";
import { InfoTip } from "@/components/ui/info-tip";
import { saveSigningChargeSettingsAction } from "./signing-charge-actions";

export function SigningChargeForm({ settings, editable }: {
  settings: { administrativeSetupFeeCents: number; largeOrderMachineThreshold: number; largeOrderCancellationFullRefundHours: number;
    businessRequiresDownPayment: boolean; setupFeeTaxTreatment: string;
    setupFeeTaxDecisionNote: string | null; updatedAt: Date };
  editable: boolean;
}) {
  const [state, action, pending] = useActionState(saveSigningChargeSettingsAction, { error: "", success: "" });
  return <div className="space-y-3">
    <p className="text-sm text-ink-soft">The recommended one-time administrative setup fee is $45.00 per new delivery location. This section only records settings; collecting any fee at signing requires the separate approved checkout and tax gates.</p>
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="updatedAt" value={settings.updatedAt.toISOString()} />
      <label className="grid gap-1 text-sm font-medium">Setup fee per new location ($) <InfoTip term="admin-setup-fee" />
        <MoneyInput name="setupFeeDollars" cents={settings.administrativeSetupFeeCents} className="rounded-control border border-line p-2" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Large order starts at this many machines <InfoTip term="large-order-down-payment" />
        <input type="number" min={1} max={1000} name="largeOrderMachineThreshold" defaultValue={settings.largeOrderMachineThreshold} required className="rounded-control border border-line p-2" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Large-order full refund window (hours)
        <input type="number" min={1} max={720} name="largeOrderCancellationFullRefundHours" defaultValue={settings.largeOrderCancellationFullRefundHours} required className="rounded-control border border-line p-2" />
        <span className="text-ink-soft font-normal">Starting value 72 hours after signing. Afterward the setup charge is ordinarily retained; each cancellation still needs owner approval and contract review.</span>
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="businessRequiresDownPayment" defaultChecked={settings.businessRequiresDownPayment} />
        Require a first-month down payment for business or property-manager orders
      </label>
      <label className="grid gap-1 text-sm font-medium">Tax treatment (CPA confirmation required) <InfoTip term="setup-fee-tax" />
        <select name="setupFeeTaxTreatment" defaultValue={settings.setupFeeTaxTreatment} className="rounded-control border border-line p-2">
          <option value="UNDECIDED">Not confirmed — block collection</option>
          <option value="TAXABLE">CPA confirmed taxable</option>
          <option value="NOT_TAXABLE">CPA confirmed not taxable</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Tax adviser decision notes
        <textarea name="setupFeeTaxDecisionNote" rows={2} maxLength={500} defaultValue={settings.setupFeeTaxDecisionNote ?? ""} className="rounded-control border border-line p-2" />
      </label>
      <div className="md:col-span-2 flex items-center gap-3">

        <button disabled={!editable || pending} type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Save signing settings</button>
        <button disabled={!editable || pending} name="operation" value="restore" formNoValidate type="submit" className="min-h-11 rounded-control border border-line px-4 text-sm">Restore signing defaults</button>
      </div>
    </form>
    {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
    {state.success ? <p role="status" className="text-sm text-ink">{state.success}</p> : null}
    {!editable ? <p className="text-sm text-ink-soft">Only the owner can change these rules.</p> : null}
  </div>;
}
