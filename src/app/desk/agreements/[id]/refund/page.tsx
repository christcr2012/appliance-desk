import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getRefundReturnReview } from "@/domains/agreements/pre-delivery-refund-return";
import { formatMoney } from "@/lib/money-ui";
import { RefundReturnForm } from "./refund-return-form";
export const metadata={title:"Reconcile external cancellation refund"};
export default async function RefundReviewPage({params}:{params:Promise<{id:string}>}){
 await requireRole("OWNER","ADMIN");
 const {id}=await params;
 const review=await getRefundReturnReview(id);
 return <div className="max-w-2xl space-y-4">
  <Link href={"/desk/agreements/"+encodeURIComponent(id)} className="underline">Back to agreement</Link>
  <h1 className="text-xl font-semibold">Reconcile completed refund</h1>
  <p>Only record funds already returned. Approval to cancel is not proof of a refund.</p>
  <p>Approved amount: {formatMoney(review.refundDueCents)}</p>
  {review.refundState==="PENDING_EXTERNAL_REFUND" ? (
   review.source==="MANUAL"||review.source==="STRIPE" ?
    <RefundReturnForm agreementId={id} fingerprint={review.fingerprint}
     refundDueCents={review.refundDueCents} source={review.source}
     providerEnabled={review.source==="MANUAL"||process.env.VERCEL_ENV!=="production"}/> :
    <p role="alert">Original receipt needs reconciliation before recording a return.</p>
  ) : <p role="status">State: {review.refundState}.
    Method: {review.refundMethod??"None"}. Reference: {review.refundReference??"None"}.
    {review.returnedOn?" Recorded date: "+review.returnedOn.toISOString().slice(0,10):""}
  </p>}
 </div>;
}
