import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { claimProviderOperation, completeProviderOperation, runProviderCall } from "@/domains/billing/provider-ops";

type Kind="MISSED_TRIP"|"RELOCATION";
const auditKind="w24.fee.provider_intent";
const sentAudit="w24.fee.provider_send_started";
/**
 * Explicit owner approval is one gate. Independently configured TEST-only
 * provider and tax treatment is another. Never post a customer charge in
 * production merely because W-24 source code has shipped.
 */
export function ownerFeeProviderEnabled() {
  return process.env.W24_APPROVED_FEE_TEST_POSTING_ENABLED==="true" &&
    process.env.VERCEL_ENV!=="production" &&
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")===true &&
    process.env.W24_FEE_TAX_POLICY_APPROVED==="true" &&
    (process.env.W24_FEE_TAX_POLICY_REFERENCE?.trim().length??0)>=12;
}
function fingerprint(input:{jobId:string;kind:Kind;customerId:string;
  subscriptionId:string;amountCents:number;reason:string;taxReference:string}) {
  return createHash("sha256").update(JSON.stringify({v:1,...input,
    currency:"usd",qty:1,invoice:"NEXT_CYCLE"})).digest("hex");
}
type Intent={jobId:string;kind:Kind;customerId:string;subscriptionId:string;
  amountCents:number;reason:string;taxReference:string;hash:string;idempotencyKey:string};
/** Reserve one exact approved fee in a provider operation. A dispatch with
 * unknown outcome is never repeated blindly. */
export async function prepareOwnerFeeInvoiceItem(actorId:string,jobId:string,kind:Kind):
  Promise<{status:"OFF"|"READY"|"ALREADY_SENT";operationId?:string}> {
  if(!ownerFeeProviderEnabled())return{status:"OFF"};
  return prisma.$transaction(async tx=>{
    const actor=await tx.user.findUnique({where:{id:actorId},select:{role:true}});
    if(!actor||actor.role!=="OWNER")throw new Error("Owner-only provider fee dispatch.");
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id"=${jobId} FOR UPDATE`;
    const job=await tx.job.findUniqueOrThrow({where:{id:jobId},
      select:{agreementId:true,customerId:true,type:true,status:true,
        noShowAt:true,tripFeeApprovedAt:true,tripFeeApprovedByUserId:true,
        approvedTripFeeReason:true,approvedTripFeeCents:true,
        relocationFeeApprovedAt:true,relocationFeeApprovedByUserId:true,
        relocationFeeEvidence:true,approvedRelocationFeeCents:true}});
    if(job.type==="MAINTENANCE_VISIT"||job.type==="SWAP")
      throw new Error("Service replacements are not chargeable trips.");
    if(kind==="MISSED_TRIP"&&(!job.noShowAt||job.status!=="CANCELLED"))
      throw new Error("Trip fee requires a real missed visit.");
    const cents=kind==="MISSED_TRIP"?job.approvedTripFeeCents:job.approvedRelocationFeeCents;
    const approved=kind==="MISSED_TRIP"?job.tripFeeApprovedAt:job.relocationFeeApprovedAt;
    const reason=kind==="MISSED_TRIP"?job.approvedTripFeeReason:job.relocationFeeEvidence;
    if(!approved||!reason||!Number.isSafeInteger(cents)||cents<=0)
      throw new Error("Missing independent owner-approved job fee evidence.");
    if(!job.agreementId)throw new Error("Billing requires a linked actual agreement.");
    const agreement=await tx.rentalAgreement.findUniqueOrThrow({where:{id:job.agreementId},
      select:{customerId:true,status:true,stripeSubscriptionId:true,paidInFullInAdvance:true,
        customer:{select:{stripeCustomerId:true}}}});
    if(agreement.customerId!==job.customerId||agreement.status!=="ACTIVE"||
       agreement.paidInFullInAdvance||!agreement.stripeSubscriptionId||
       !agreement.customer.stripeCustomerId)
      throw new Error("No active customer-owned recurring subscription to bill next cycle.");
    const payload={jobId,kind,customerId:agreement.customer.stripeCustomerId,
      subscriptionId:agreement.stripeSubscriptionId,amountCents:cents,
      reason,taxReference:process.env.W24_FEE_TAX_POLICY_REFERENCE!.trim()};
    const hash=fingerprint(payload);
    const idempotencyKey="w24-"+(kind==="MISSED_TRIP"?"trip":"relocate")+"-"+jobId;
    const existing=await tx.providerOperation.findUnique({
      where:{idempotencyKey},select:{id:true,status:true,providerObjectId:true,kind:true}});
    if(existing){
      if(existing.kind!==(kind==="MISSED_TRIP"?
        "TRIP_FEE_INVOICE_ITEM":"RELOCATION_INVOICE_ITEM"))
        throw new Error("Fee key belongs to a different financial operation.");
      const intent=await tx.auditLog.findFirst({where:{
        entityType:"ProviderOperation",entityId:existing.id,action:auditKind},
        select:{newValue:true}});
      if((intent?.newValue as {hash?:string}|null)?.hash!==hash)
        throw new Error("Owner-approved fee changed after the immutable provider intent.");
      if(existing.status==="SUCCEEDED"&&existing.providerObjectId)
        return{status:"ALREADY_SENT" as const,operationId:existing.id};
    }
    const claim=await claimProviderOperation(tx,{
      kind:kind==="MISSED_TRIP"?"TRIP_FEE_INVOICE_ITEM":"RELOCATION_INVOICE_ITEM",
      subjectType:"Job",subjectId:jobId,idempotencyKey,
    });
    if(claim.done)return{status:"ALREADY_SENT" as const};
    if(!existing) await tx.auditLog.create({data:{
      userId:actorId,action:auditKind,entityType:"ProviderOperation",
      entityId:claim.opId,newValue:{...payload,hash}}});
    return{status:"READY" as const,operationId:claim.opId};
  },{isolationLevel:"Serializable"});
}
export async function dispatchOwnerFeeInvoiceItem(operationId:string) {
  if(!ownerFeeProviderEnabled())throw new Error("Owner fee provider dispatch remains disabled.");
  const intent=await prisma.$transaction(async tx=>{
    const op=await tx.providerOperation.findUnique({where:{id:operationId}});
    if(!op||!["TRIP_FEE_INVOICE_ITEM","RELOCATION_INVOICE_ITEM"].includes(op.kind)||
        op.status!=="PENDING")return null;
    const prior=await tx.auditLog.findFirst({where:{action:sentAudit,
      entityType:"ProviderOperation",entityId:operationId}});
    if(prior)throw new Error("Provider fee send already started. Reconcile before retrying.");
    const source=await tx.auditLog.findFirst({where:{action:auditKind,
      entityType:"ProviderOperation",entityId:operationId},select:{newValue:true}});
    const d=source?.newValue as Intent|null;
    if(!d||d.idempotencyKey!==undefined||
      d.hash!==fingerprint({jobId:d.jobId,kind:d.kind,customerId:d.customerId,
        subscriptionId:d.subscriptionId,amountCents:d.amountCents,
        reason:d.reason,taxReference:d.taxReference}))
      throw new Error("Invalid immutable fee dispatch evidence.");
    if(d.taxReference!==process.env.W24_FEE_TAX_POLICY_REFERENCE?.trim())
      throw new Error("Fee tax approval changed; do not dispatch.");
    await tx.auditLog.create({data:{action:sentAudit,entityType:"ProviderOperation",
      entityId:operationId,newValue:{hash:d.hash,key:op.idempotencyKey}}});
    return{...d,idempotencyKey:op.idempotencyKey};
  });
  if(!intent)return;
  const result=await runProviderCall(()=>getStripeClient().invoiceItems.create({
    customer:intent.customerId,subscription:intent.subscriptionId,
    amount:intent.amountCents,currency:"usd",quantity:1,
    description:intent.kind==="MISSED_TRIP"?"Owner-approved missed delivery trip":"Owner-approved appliance relocation",
    // Tax compliance is an independent written owner/professional approval gate;
    // no automatic tax call nor implicit tax-exempt assumption.
    tax_rates:[],
    metadata:{w24_job_id:intent.jobId,w24_fee_kind:intent.kind,
      w24_intent_hash:intent.hash,w24_tax_reference:intent.taxReference},
  },{idempotencyKey:intent.idempotencyKey}));
  await prisma.$transaction(async tx=>{
    if(result.ok){
      await completeProviderOperation(tx,operationId,{
        status:"SUCCEEDED",providerObjectId:result.value.id});
      await tx.staffTask.updateMany({where:{
        sourceKey:"w24-review-next-bill:"+intent.kind+":"+intent.jobId,
        completedAt:null},data:{completedAt:new Date()}});
    }else{
      await completeProviderOperation(tx,operationId,{
        status:result.outcome,error:result.error});
    }
  });
}
