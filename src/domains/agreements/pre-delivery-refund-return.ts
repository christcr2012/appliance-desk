import { getCancellationReserveInTx } from "@/domains/billing/signing-cancellation-reserve";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getStripeClient } from "@/lib/stripe";
import { lockRentalAgreementInTx } from "./index";
import { validateExternalStripeRefund, validateManualReturn, type RefundReturnMethod } from "./pre-delivery-refund-evidence";
type Tx = Prisma.TransactionClient;
async function reviewInTx(tx: Tx, agreementId: string) {
 const row = await tx.preDeliveryCancellation.findUnique({where:{agreementId}});
 if(!row)throw new Error("No approved refund exists for this cancellation.");
 const agreement = await tx.rentalAgreement.findUniqueOrThrow({
  where:{id:agreementId},
  select:{status:true,firstDeliveredOn:true,customerId:true,depositCents:true},
 });
 if(agreement.status!=="CANCELLED"||agreement.firstDeliveredOn)
   throw new Error("Only an approved undelivered cancellation may be reconciled.");
 const receipt = row.receiptId ? await tx.receipt.findUnique({
  where:{id:row.receiptId},select:{
   id:true,source:true,customerId:true,amountCents:true,stripeChargeId:true,
  },
 }) : null;
 const obligation = await tx.agreementSigningPayment.findUnique({
  where:{agreementId},

 });
 if(row.refundDueCents>0 && (!receipt||receipt.customerId!==agreement.customerId||
    receipt.amountCents!==row.signedAmountCents||obligation?.status!=="SETTLED"||
    obligation.receiptId!==receipt.id||obligation.orderFingerprint!==row.orderFingerprint))
    throw new Error("Approved refund does not match the original signing receipt.");
 if(row.refundDueCents<0||row.refundDueCents>row.signedAmountCents||
    row.refundDueCents+row.retainedCents!==row.signedAmountCents)
    throw new Error("Approved refund cents do not reconcile.");
 const fingerprint=createHash("sha256").update(JSON.stringify([
  row.agreementId,row.receiptId,row.orderFingerprint,row.refundState,
  row.refundDueCents,row.retainedCents,row.approvedAt.toISOString(),row.refundReference,
 ])).digest("hex");
 const reserve=row.refundState==="PENDING_EXTERNAL_REFUND" && obligation ? await getCancellationReserveInTx(tx,{...obligation,agreementDepositCents:agreement.depositCents}) : null;
 return {row,receipt,fingerprint,reserve};
}

export async function getRefundReturnReview(agreementId:string) {
 await requireRole("OWNER","ADMIN");
 const {row,receipt,fingerprint}=await prisma.$transaction(tx=>reviewInTx(tx,agreementId));
 return {agreementId,refundDueCents:row.refundDueCents,refundState:row.refundState,
  refundMethod:row.refundMethod,refundReference:row.refundReference,
  returnedOn:row.returnedOn,recordedAt:row.returnedRecordedAt,
  source:receipt?.source??null,fingerprint,receiptId:receipt?.id??null};
}
export async function recordExternallyReturnedRefund(input: {
 agreementId:string;actorUserId:string;expectedFingerprint:string;
 method:RefundReturnMethod;reference:string;confirmedReturned:boolean;
}) {
 if(!input.confirmedReturned)throw new Error("Confirm the completed return.");
 const preview=await getRefundReturnReview(input.agreementId);
 if(preview.refundState!=="PENDING_EXTERNAL_REFUND"||preview.refundDueCents<=0)
   throw new Error("No outstanding approved return exists.");
 const reference=input.reference.trim();
 let evidence:ReturnType<typeof validateExternalStripeRefund>|null=null;
 let returnedOn=new Date();
 if(input.method==="STRIPE_TEST_REFUND") {
  if(process.env.VERCEL_ENV==="production")throw new Error("TEST provider verification is disabled in production.");
  if(preview.source!=="STRIPE"||!preview.receiptId||!/^re_[a-zA-Z0-9]+$/.test(reference))
    throw new Error("A valid original Stripe TEST refund identifier is required.");
  const receipt=await prisma.receipt.findUnique({
   where:{id:preview.receiptId},select:{stripeChargeId:true},
  });
  if(!receipt?.stripeChargeId)throw new Error("Original Stripe charge is missing.");
  if(!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Only an authorized Stripe TEST key can verify this refund.");
  const provider=await getStripeClient().refunds.retrieve(reference);
  evidence=validateExternalStripeRefund(provider,{
   refundId:reference,chargeId:receipt.stripeChargeId,amountCents:preview.refundDueCents,
  });
  returnedOn=new Date(provider.created*1000);
 } else {
  if(preview.source!=="MANUAL")throw new Error("Stripe-origin returns require provider evidence.");
  validateManualReturn({method:input.method,reference,confirmedReturned:true,amountCents:preview.refundDueCents});
 }
 await prisma.$transaction(async tx => {
  await assertActiveTeamActor(tx,input.actorUserId,["OWNER","ADMIN"]);
  await lockRentalAgreementInTx(tx,input.agreementId);
  await tx.$queryRaw`SELECT "agreementId" FROM "PreDeliveryCancellation"
    WHERE "agreementId" = ${input.agreementId} FOR UPDATE`;
  const current=await reviewInTx(tx,input.agreementId);
  if(current.fingerprint!==input.expectedFingerprint||
     current.fingerprint!==preview.fingerprint||
     current.row.refundState!=="PENDING_EXTERNAL_REFUND")
    throw new Error("Refund state changed. Refresh and review again.");
  if(returnedOn.getTime()<current.row.approvedAt.getTime())
    throw new Error("Refund predates approval and requires separate reconciliation.");
  if(evidence && current.receipt?.stripeChargeId!==evidence.originalChargeId)
    throw new Error("The provider refund does not match the original charge.");
  if(!evidence && current.receipt?.source!=="MANUAL")
    throw new Error("Manual confirmation cannot stand in for a Stripe readback.");
  const method=input.method;
  const newState=evidence?"RETURNED_STRIPE_TEST_VERIFIED":"RETURNED_MANUAL_RECORDED";
  if(current.reserve){
   // Approval alone leaves funds held. Only this independently confirmed
   // whole cancellation return may discharge its included reserve liability.
   if(current.row.refundDueCents<current.reserve.amountCents)
     throw new Error("Approved return cannot cover the full refundable reserve.");
   await tx.deposit.update({where:{id:current.reserve.id},data:{
     refundedAt:returnedOn,refundedAmountCents:current.reserve.amountCents,
     refundedByUserId:input.actorUserId,
     stripeRefundId:evidence?reference:null,
   }});
  }
  await tx.preDeliveryCancellation.update({
   where:{agreementId:input.agreementId},
   data:{refundState:newState,returnedOn,returnedRecordedAt:new Date(),
    returnedByUserId:input.actorUserId,refundMethod:method,refundReference:reference,
    returnEvidence:evidence??{kind:"OWNER_ATTESTED_MANUAL_RETURN",reference,method}},
  });
  await tx.auditLog.create({data:{
   userId:input.actorUserId,action:"agreement.pre_delivery_refund_reconciled",
   entityType:"RentalAgreement",entityId:input.agreementId,
   newValue:{refundState:newState,amountCents:current.row.refundDueCents,
    method,reference,sourceReceiptId:current.receipt?.id,returnedOn:returnedOn.toISOString()},
  }});
 });
 return {refundState:evidence?"RETURNED_STRIPE_TEST_VERIFIED":"RETURNED_MANUAL_RECORDED",
  reference,returnedOn};
}

export type { RefundReturnMethod } from "./pre-delivery-refund-evidence";
