"use client";
import { useActionState } from "react";
import { saveSigningBusinessReviewAction } from "./signing-business-review-action";
export function SigningBusinessReviewForm({agreementId,fingerprint,day,editable,current}: {
  agreementId:string;fingerprint:string;day:string;editable:boolean;current:string;
}){
  const [state,action,pending]=useActionState(saveSigningBusinessReviewAction,{ok:false,message:""});
  return <section className="mt-4 rounded-lg border border-line p-4" aria-label="Signing business clearance">
    <h2 className="font-semibold">Signing business clearance</h2>
    <p className="mt-2 text-sm text-ink-soft">Record advice you have actually received from your CPA and attorney for this exact frozen order, including its services, tax, delivery fee, refundable reserve and cancellation terms. A planning calculation or a test is not professional advice. New revisions preserve all earlier records.</p>
    <p className="mt-2 text-sm">{current}</p>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="agreementId" value={agreementId}/>
      <input type="hidden" name="expectedOrderFingerprint" value={fingerprint}/>
      <fieldset disabled={!editable||pending} className="space-y-3">
        <label className="block text-sm">Decision<select name="decision" className="mt-1 block rounded border border-line bg-surface p-2">
          <option value="REVIEW_REQUIRED">Keep business use restricted</option>
          <option value="APPROVED">Advice received and exact terms reviewed</option>
        </select></label>
        <label className="block text-sm">Effective Colorado business day<input type="date" name="effectiveFromKey" defaultValue={day} required className="mt-1 block rounded border border-line bg-surface p-2"/></label>
        <label className="block text-sm">Advice received on<input type="date" name="confirmedOnKey" max={day} required className="mt-1 block rounded border border-line bg-surface p-2"/></label>
        {[["taxAdviserReference","CPA advice reference"],["legalAdviserReference","Attorney advice reference"],["termsReference","Exact reviewed terms reference"],["reason","Reason for this decision"]].map(([name,label])=><label key={name} className="block text-sm">{label}<textarea name={name} minLength={12} maxLength={500} required rows={2} className="mt-1 block w-full rounded border border-line bg-surface p-2"/></label>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acknowledged" required/>I confirm this records advice actually received and the exact order and terms I reviewed. This does not authorize a refund, public pricing, sending messages or Stripe LIVE.</label>
        <button className="rounded bg-action px-4 py-2 text-sm text-on-action disabled:opacity-50" type="submit">{pending?"Recording…":"Record review revision"}</button>
      </fieldset>
      {!editable&&<p className="text-sm text-ink-soft">Only the owner may record or revoke clearance.</p>}
      {state.message&&<p role={state.ok?"status":"alert"} className="text-sm">{state.message}</p>}
    </form>
  </section>;
}
