"use client";
import { useActionState } from "react";
import Link from "next/link";
import { MoneyInput } from "@/components/ui/money";
import { InfoTip } from "@/components/ui/info-tip";
import { saveSigningChargeSettingsAction } from "./signing-charge-actions";

export function SigningChargeForm({ settings, editable, activeTaxTreatment, upcomingPolicies }: {
  settings: { administrativeSetupFeeCents: number; largeOrderMachineThreshold: number; largeOrderCancellationFullRefundHours: number;
    businessRequiresDownPayment: boolean; setupFeeTaxTreatment: string;
    setupFeeTaxPlanningTreatment: string;
    setupFeeTaxDecisionNote: string | null; setupFeeTaxConfirmedOn: Date | null;
    setupFeeTaxEffectiveFrom: Date | null; setupFeeTaxApprovedAt: Date | null;
    setupFeeTaxAdviserReference: string | null; updatedAt: Date };
  editable: boolean;
  activeTaxTreatment: "UNDECIDED" | "TAXABLE" | "NOT_TAXABLE";
  upcomingPolicies: { id: string; effectiveFromKey: string; treatment: string }[];
}) {
  const [state, action, pending] = useActionState(saveSigningChargeSettingsAction, { error: "", success: "" });
  const taxApproved = activeTaxTreatment !== "UNDECIDED";
  return <div className="space-y-3">
    <section aria-label="Setup fee CPA approval status" className="space-y-2 rounded border border-line p-3 text-sm">
      <p role="status" className="font-semibold">{taxApproved ? "CPA-supported setup-fee policy recorded" : "Setup-fee tax decision: review required — affected real customer transactions stay blocked"}</p>
      <p>Current research-based planning setting: {settings.setupFeeTaxPlanningTreatment === "NOT_TAXABLE" ? "not taxable" : "taxable"}. It is editable below but cannot bypass CPA confirmation, enable Stripe or publish pricing.</p>
      <p>The fee rule is only one part of clearance. Also confirm each tax area&apos;s taxability and rates on <Link className="underline" href="/desk/sales-tax/taxability">Money → Sales tax → What&apos;s taxed?</Link> and verify the customer address on <Link className="underline" href="/desk/sales-tax/areas">Tax areas</Link>. Each unresolved gate still blocks the affected business transaction.</p>
      {taxApproved && <p>Effective policy today: {activeTaxTreatment === "TAXABLE" ? "taxable" : "not taxable"}. Previous signed amounts are unchanged.</p>}
      {upcomingPolicies.length > 0 && <div>
        <p className="font-semibold">Scheduled changes (not active yet)</p>
        <ul className="list-disc pl-5">{upcomingPolicies.map(policy =>
          <li key={policy.id}>{policy.effectiveFromKey}: {policy.treatment === "TAXABLE" ? "taxable" : policy.treatment === "NOT_TAXABLE" ? "not taxable" : "unconfirmed"}</li>)}
        </ul>
      </div>}
    </section>
    <p className="text-sm text-ink-soft">The recommended one-time administrative setup fee is $45.00 per new delivery location. This section only records settings; collecting any fee at signing requires the separate approved checkout and tax gates.</p>
    <form action={action} className="grid min-w-0 gap-3 md:grid-cols-2">
      <input type="hidden" name="updatedAt" value={settings.updatedAt.toISOString()} />
      <label className="grid min-w-0 gap-1 text-sm font-medium">Setup fee per new location ($) <InfoTip term="admin-setup-fee" />
        <MoneyInput name="setupFeeDollars" cents={settings.administrativeSetupFeeCents} className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium">Large order starts at this many machines <InfoTip term="large-order-down-payment" />
        <input type="number" min={1} max={1000} name="largeOrderMachineThreshold" defaultValue={settings.largeOrderMachineThreshold} required className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium">Large-order full refund window (hours)
        <input type="number" min={1} max={720} name="largeOrderCancellationFullRefundHours" defaultValue={settings.largeOrderCancellationFullRefundHours} required className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
        <span className="text-ink-soft font-normal">Starting value 72 hours after signing. Afterward the setup charge is ordinarily retained; each cancellation still needs owner approval and contract review.</span>
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="businessRequiresDownPayment" defaultChecked={settings.businessRequiresDownPayment} />
        Require a first-month down payment for business or property-manager orders
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium md:col-span-2">Provisional research-based tax assumption
        <select name="setupFeeTaxPlanningTreatment" defaultValue={settings.setupFeeTaxPlanningTreatment} className="min-w-0 w-full max-w-full rounded-control border border-line p-2">
          <option value="TAXABLE">Taxable — current research-based starting choice</option>
          <option value="NOT_TAXABLE">Not taxable — owner-only planning scenario</option>
        </select>
        <span className="font-normal text-ink-soft">Planning default only. Does not authorize customer billing or replace CPA confirmation. Source: Colorado DOR, Sales &amp; Use Tax Topics: Leases.</span>
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium">Tax treatment (CPA confirmation required) <InfoTip term="setup-fee-tax" />
        <select name="setupFeeTaxTreatment" defaultValue={settings.setupFeeTaxTreatment} className="min-w-0 w-full max-w-full rounded-control border border-line p-2">
          <option value="UNDECIDED">Not confirmed — block collection</option>
          <option value="TAXABLE">Taxable (requires recorded CPA evidence below)</option>
          <option value="NOT_TAXABLE">Not taxable (requires recorded CPA evidence below)</option>
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium">CPA determination and reasoning
        <textarea name="setupFeeTaxDecisionNote" rows={2} maxLength={500} defaultValue={settings.setupFeeTaxDecisionNote ?? ""} className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium">CPA confirmation date
        <input type="date" name="setupFeeTaxConfirmedOn" defaultValue={settings.setupFeeTaxConfirmedOn?.toISOString().slice(0,10)} className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium">Apply reviewed rule from this date
        <input type="date" name="setupFeeTaxEffectiveFrom" defaultValue={settings.setupFeeTaxEffectiveFrom?.toISOString().slice(0,10)} className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
        <span className="font-normal text-ink-soft">Changes apply to eligible future actions; previous signed agreements and bills remain frozen.</span>
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-medium md:col-span-2">CPA name and traceable reference (email subject, opinion date or memo reference; no credentials)
        <input name="setupFeeTaxAdviserReference" maxLength={500} defaultValue={settings.setupFeeTaxAdviserReference ?? ""} className="min-w-0 w-full max-w-full rounded-control border border-line p-2" />
      </label>
      <label className="flex items-start gap-2 text-sm md:col-span-2">
        <input name="setupFeeTaxOwnerAttested" type="checkbox" className="mt-1" />
        <span>I confirm that the chosen tax treatment was actually reviewed with a qualified adviser and that the recorded details match the advice. An unconfirmed choice must stay Not confirmed. Reaffirm this when saving a confirmed decision.</span>
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
