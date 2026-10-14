"use client";
import { useActionState } from "react";
import { formatMoney } from "@/lib/money-ui";
import { recordReturnedRefundAction } from "./actions";
export function RefundReturnForm(props:{
 agreementId:string;fingerprint:string;refundDueCents:number;
 source:"MANUAL"|"STRIPE";providerEnabled:boolean;
}){
 const [state,action,pending]=useActionState(recordReturnedRefundAction,{error:""});
 const manual=props.source==="MANUAL";
 return <form action={action} className="space-y-4 rounded-lg border p-4">
  <input type="hidden" name="agreementId" value={props.agreementId}/>
  <input type="hidden" name="fingerprint" value={props.fingerprint}/>
  <p>Approved return: <strong>{formatMoney(props.refundDueCents)}</strong></p>
  <p>This only records a previously completed return.</p>
  <label className="grid gap-1">Return method
   <select required name="method" className="rounded-md border p-2">
    {manual ? <>
     <option value="MANUAL_CHECK">Check returned</option>
     <option value="MANUAL_BANK_TRANSFER">Bank transfer completed</option>
     <option value="MANUAL_CASH">Cash handed back</option>
    </> : <option value="STRIPE_TEST_REFUND">Verified Stripe TEST refund</option>}
   </select>
  </label>
  <label className="grid gap-1">Evidence reference
   <input name="reference" required minLength={6} maxLength={120} className="rounded-md border p-2"/>
  </label>
  <label className="flex gap-2">
   <input name="confirmedReturned" type="checkbox" required/>
   I verified the return happened and authorize recording its evidence.
  </label>
  {manual&&<p>Manual return is owner-attested, not provider-verified.</p>}
  {state.error&&<p role="alert">{state.error}</p>}
  <button type="submit" disabled={pending||!props.providerEnabled}>
   Record returned refund evidence
  </button>
 </form>;
}
