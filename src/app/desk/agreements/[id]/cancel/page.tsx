import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getAgreementById } from "@/domains/agreements";
import { getPreDeliveryCancellationQuote } from "@/domains/agreements/pre-delivery-cancellation";
import { formatMoney } from "@/lib/money-ui";
import { CancellationApprovalForm } from "./cancellation-approval-form";
export const metadata = {title:"Review cancellation before delivery"};
export default async function CancelPage({params}:{params:Promise<{id:string}>}) {
 await requireRole("OWNER","ADMIN");
 const {id}=await params;
 const agreement=await getAgreementById(id);
 if(!agreement)return <p>Agreement not found.</p>;
 let quote:Awaited<ReturnType<typeof getPreDeliveryCancellationQuote>>|null=null;
 let blocker:string|null=null;
 try { quote=await getPreDeliveryCancellationQuote(id); }
 catch(e) {blocker=e instanceof Error?e.message:"Reconciliation required.";}
 return <div className="max-w-2xl space-y-4">
  <Link href={"/desk/agreements/"+encodeURIComponent(id)} className="underline">Back to agreement</Link>
  <h1 className="text-xl font-semibold">Cancellation and refund review</h1>
  <p>Customer: {agreement.customer.user.name??agreement.customer.user.email}</p>
  <p>Review the actual signed terms. A scheduled delivery is not a completed delivery.</p>
  {blocker && <p role="alert" className="border p-4">{blocker} No refund or cancellation was recorded.</p>}
  {quote && <section className="border rounded-lg p-4">
   <h2 className="font-semibold">Verified signing money</h2>
   <p>Received: {formatMoney(quote.signingAmountCents)}</p>
   <p>Standard refund due: {formatMoney(quote.refundableCents)}</p>
   <p>Standard amount retained: {formatMoney(quote.retainedCents)}</p>
   <p>{quote.receiptId?"A linked receipt exists.":"There is no settled signing receipt."}</p>
   {quote.policyEvidenceStatus === "SIGNED" ? (
     <div className="mt-2 space-y-1 text-sm">
       <p>Original signing policy: {quote.largeOrder ? "large order" : "ordinary order"}.
         {quote.largeOrderReasons.length > 0
           ? " Basis: " + quote.largeOrderReasons.map(reason => ({
               MACHINE_THRESHOLD:"original order machine count",
               BUSINESS_CUSTOMER:"business customer",
               PROPERTY_MANAGER:"property manager",
             }[reason] ?? reason)).join(", ") + "." : ""}
       </p>
       {quote.largeOrder && <p>The {quote.fullRefundHours}-hour full-refund window from signing
         {quote.withinFullRefundWindow ? " is still open." : " has passed."}</p>}
     </div>
   ) : (
     <p role="status" className="mt-2 border border-line p-2 text-sm">
       Historical signing policy was not frozen for this agreement. No setup-fee
       retention is calculated from today&apos;s settings. Full refund only; review
       the actual signed terms and finance history before approval.
     </p>
   )}
   <CancellationApprovalForm agreementId={id} fingerprint={quote.fingerprint}
     canRetain={quote.defaultPolicy==="RETAIN_SETUP"} defaultPolicy={quote.defaultPolicy} receiptCents={quote.signingAmountCents} setupCents={quote.setupAndTaxCents}/>
  </section>}
 </div>;
}
