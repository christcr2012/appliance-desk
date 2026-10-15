"use client";

import { useActionState } from "react";
import type { PreparedReserveOverview } from
  "@/domains/estimates/commercial-reserve-allocation";
import {
  saveCommercialReserveAction,
} from "@/app/desk/estimates/[id]/commercial-reserve-action";
// Client-safe formatter: importing the pricing domain index bundles Prisma.
const formatCents=(cents:number)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency:"USD",
}).format(cents/100);

export function CommercialReserveAllocationForm({overview,owner}:{
  overview:PreparedReserveOverview;owner:boolean;
}){
  const [status,action,pending]=useActionState(saveCommercialReserveAction,{success:"",error:""});
  const eligible=overview.canAllocate&&owner;
  return <section aria-labelledby="commercial-reserve-title"
    className="mt-5 space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
    <h2 id="commercial-reserve-title" className="font-semibold">
      Negotiated refundable commercial reserve — owner draft
    </h2>
    <p className="text-ink-soft">
      This amount is a separately refundable security liability, not rent, a
      setup fee or money already received. Household estimates cannot charge it.
      Negotiate and allocate the exact requested amount once across all actual
      service locations; signable legal wording and any deductions still require
      review. Quarterly replenishment records an intended term only and never
      charges automatically.
    </p>
    <dl className="grid gap-2 sm:grid-cols-2">
      <div><dt>Estimate requested reserve</dt>
        <dd className="font-medium">{formatCents(overview.expectedReserveCents)}</dd></div>
      <div><dt>Prepared agreement reserve total</dt>
        <dd className="font-medium">{formatCents(overview.allocatedReserveCents)}</dd></div>
    </dl>
    {!overview.businessEligible&&overview.expectedReserveCents>0&&
      <p role="alert" className="text-red-700">This household cannot owe a
      security reserve. Remove it from the estimate before further review.</p>}
    {overview.reasons.length>0&&<div className="border-l-2 border-amber-500 pl-3">
      <p className="font-medium">Before this can become a binding quote</p>
      <ul className="list-inside list-disc text-ink-soft">
        {overview.reasons.map(r=><li key={r}>{r}</li>)}
      </ul>
    </div>}
    <form action={action} className="space-y-3">
      <input type="hidden" name="estimateId" value={overview.estimateId}/>
      <input type="hidden" name="estimateUpdatedAt" value={overview.estimateUpdatedAt}/>
      {overview.allocations.map((row,index)=><fieldset key={row.agreementId}
        className="space-y-2 rounded border border-line p-3">
        <legend className="px-1 font-medium">{row.addressLabel}</legend>
        <input type="hidden" name="agreementId" value={row.agreementId}/>
        <input type="hidden" name={"revision_"+index} value={row.revision??""}/>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1">
            Refundable security reserve in dollars
            <input name={"amount_"+index} type="number" inputMode="decimal"
              min="0" max="1000000" step="0.01" required
              defaultValue={(row.amountCents/100).toFixed(2)}
              disabled={!eligible||pending}
              className="w-full rounded border border-line bg-surface p-2"/>
          </label>
          <label className="grid gap-1">
            Negotiated replenishment
            <select name={"replenishment_"+index} defaultValue={row.replenishment}
              disabled={!eligible||pending} className="w-full rounded border border-line bg-surface p-2">
              <option value="NONE">Not applicable / none</option>
              <option value="QUARTERLY">Quarterly (terms only)</option>
            </select>
          </label>
        </div>
        <label className="grid gap-1">
          Negotiated terms or no-reserve reference
          <textarea name={"terms_"+index} maxLength={500} rows={2}
            required minLength={12} disabled={!eligible||pending}
            defaultValue={row.termsReference||
              "No security reserve has been negotiated for this delivery location."}
            className="w-full rounded border border-line bg-surface p-2"/>
        </label>
        <p className="text-xs text-ink-soft">
          Original policy revision: {row.revision??"not recorded"}.
          Legal status: review required. No automatic damage deduction or refund.
        </p>
      </fieldset>)}
      {owner&&<label className="grid gap-1">
        Owner reason for this full-order revision
        <textarea name="reason" maxLength={500} minLength={12} rows={2}
          placeholder="Why was the negotiated reserve allocated or changed?"
          required disabled={!eligible||pending}
          className="w-full rounded border border-line bg-surface p-2"/>
      </label>}
      {eligible&&<button type="submit" disabled={pending||!overview.allocations.length}
        className="rounded bg-action px-4 py-2 font-medium text-on-action disabled:opacity-50">
        {pending?"Recording reviewed terms…":"Record all location reserve decisions"}
      </button>}
      {!owner&&<p className="text-ink-soft">Only the OWNER may record or change negotiated reserve terms.</p>}
      {!overview.canAllocate&&<p className="text-ink-soft">Only editable, unfunded prepared estimates may change this reserve.</p>}
      {status.error&&<p role="alert" className="text-red-700">{status.error}</p>}
      {status.success&&<p role="status" className="text-ink">{status.success}</p>}
    </form>
    <p className="text-xs text-ink-soft">This form does not authorize a
      payable customer quote, deposit collection, refund, contract signature or
      external communication. Existing historical signed amounts stay unchanged.</p>
  </section>;
}
