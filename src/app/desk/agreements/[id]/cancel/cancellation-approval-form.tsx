"use client";
import { useActionState, useState } from "react";
import { formatMoney } from "@/lib/money-ui";
import { approveCancellationAction } from "./actions";
export function CancellationApprovalForm({agreementId,fingerprint,canRetain,defaultPolicy,receiptCents,setupCents}:{
 agreementId:string;fingerprint:string;canRetain:boolean;defaultPolicy:"FULL_REFUND"|"RETAIN_SETUP";receiptCents:number;setupCents:number;
}) {
 const [state,action,pending]=useActionState(approveCancellationAction,{error:""});
 const [policy,setPolicy]=useState(defaultPolicy);
 const retained=policy==="RETAIN_SETUP"?setupCents:0;
 return <form action={action} className="mt-5 space-y-4 border rounded-lg p-4">
  <input type="hidden" name="agreementId" value={agreementId}/>
  <input type="hidden" name="fingerprint" value={fingerprint}/>
  <fieldset className="space-y-2"><legend className="font-semibold">Choose refund decision</legend>
   <label className="block"><input type="radio" name="policy" value="FULL_REFUND" checked={policy==="FULL_REFUND"} onChange={()=>setPolicy("FULL_REFUND")}/> Full refund, no setup retention</label>
   {canRetain&&<label className="block"><input type="radio" name="policy" value="RETAIN_SETUP" checked={policy==="RETAIN_SETUP"} onChange={()=>setPolicy("RETAIN_SETUP")}/> Retain originally recorded setup fee and tax</label>}
  </fieldset>
  <div role="status" aria-live="polite" className="rounded-md border p-3 text-sm">
   <p>Refund to be recorded as due: <strong>{formatMoney(receiptCents-retained)}</strong></p>
   <p>Setup amount to retain: <strong>{formatMoney(retained)}</strong></p>
  </div>
  <label className="block">Cancellation reason and exceptions
   <textarea name="reason" required minLength={12} maxLength={500} rows={3} className="w-full border rounded-lg p-2"/>
  </label>
  <label className="block"><input type="checkbox" name="reviewedTerms" required/> I reviewed this customer&apos;s agreed terms and approve cancellation.</label>
  <p className="text-sm">No refund is sent or marked returned. Money-out requires separate authorization and provider evidence. An outside-window full refund needs an explicit documented override.</p>
  {state.error&&<p role="alert">{state.error}</p>}
  <button disabled={pending} type="submit" className="rounded-lg border p-3">Approve cancellation and record refund due</button>
 </form>;
}
