import { getPreparedEstimateQuote } from "@/domains/estimates/preapproval-quote";
import { sendEstimate,approveEstimate,convertEstimateToAgreements } from "@/domains/estimates";
import { createDepositCheckoutSessionForEstimate } from "@/domains/billing/checkout";
import type Stripe from "stripe";
import { completeJob } from "@/domains/jobs";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { businessDateFromKey } from "@/lib/business-date";
const provider=vi.hoisted(()=>({params:null as Stripe.SubscriptionCreateParams|null,calls:0}));
vi.mock("@/lib/stripe",()=>({getStripeClient:()=>({
 products:{create:async()=>({id:"prod_v2_synthetic_"+tag})},
 subscriptions:{create:async(params:Stripe.SubscriptionCreateParams)=>{provider.params=params;provider.calls++;return {id:"sub_v2_synthetic_"+tag,latest_invoice:"in_v2_synthetic_"+tag};}},
 invoices:{
  retrieve:async()=>({id:"in_v2_synthetic_"+tag,livemode:false,billing_reason:"subscription_create",currency:"usd",customer:provider.params?.customer,
   status:"open",parent:{subscription_details:{subscription:"sub_v2_synthetic_"+tag}}}),
  listLineItems:async()=>({has_more:false,data:(provider.params?.add_invoice_items??[]).map((row,i)=>({id:"il_v2_synthetic_"+tag+"_"+i,livemode:false,
    invoice:"in_v2_synthetic_"+tag,amount:row.price_data?.unit_amount,metadata:row.metadata}))}),
 },
})}));
import { createSyntheticW22V2Order } from "./helpers/w22-v2-order";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { getFrozenSigningOrderInTx } from "@/domains/billing/signing-frozen-verify";
import { recordSigningBusinessReview,validateSigningBusinessReview } from "@/domains/billing/signing-business-review";
import { sendForSignature,signAgreement } from "@/domains/agreements";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { recordManualSigningPayment } from "@/domains/billing/signing-payment-manual";
import { getPreDeliveryCancellationQuote,approvePreDeliveryCancellation } from "@/domains/agreements/pre-delivery-cancellation";
import { getRefundReturnReview,recordExternallyReturnedRefund } from "@/domains/agreements/pre-delivery-refund-return";
import { decideDepositRefund } from "@/domains/billing/deposit-refunds";
import { updateJobStatus } from "@/domains/jobs";
import { signingFirstInvoiceItem } from "@/domains/billing/signing-first-invoice-application";
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:async()=>({user:{id:owner,role:"OWNER",archivedAt:null}})}}}));
vi.mock("@/domains/security/two-factor",()=>({twoFactorEnrollmentRequired:async()=>false}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&url.pathname==="/appliance_desk_test"&&["localhost","127.0.0.1"].includes(url.hostname);
let owner="";
vi.mock("@/lib/email",()=>({sendEmail:async()=>({sent:true})}));
const tag=randomUUID().replaceAll("-","");
const day=businessDateKey(new Date());
let cleanup:(()=>Promise<void>)|undefined;
const ids:string[]=[];
let orderFingerprint="";
let estimateId="";
const review=(agreementId=ids[0],decision:"APPROVED"|"REVIEW_REQUIRED"="APPROVED")=>({
  agreementId,expectedOrderFingerprint:orderFingerprint,decision,
  effectiveFromKey:day,confirmedOnKey:day,taxAdviserReference:"Synthetic CPA advice for isolated test only",
  legalAdviserReference:"Synthetic attorney advice for isolated test only",termsReference:"Synthetic complete signing and refund terms",
  reason:"Synthetic owner attestation; no actual professional approval",acknowledged:true,
});
describe.skipIf(!enabled)("V2 two-address sign, settlement, reserve, cancellation and dispatch (disposable Postgres)",()=>{
 beforeAll(async()=>{
  const fixture=await createSyntheticW22V2Order();
  owner=fixture.owner;ids.push(...fixture.ids);orderFingerprint=fixture.orderFingerprint;
  cleanup=fixture.cleanup;estimateId=fixture.estimateId;
 });
 afterAll(async()=>{await cleanup?.();});
 it("requires real owner records for each frozen location and refuses staff, stale and future-confirmation submissions",async()=>{
  const frozen=await prisma.$transaction(tx=>getFrozenSigningOrderInTx(tx,ids[0]));
  expect(frozen.map(row=>row.allInCents).sort((a,b)=>a-b)).toEqual([16975,28631]);
  await expect(sendForSignature(owner,ids[0])).rejects.toThrow(/owner-recorded CPA/);
  const staff=await prisma.user.findFirstOrThrow({where:{role:"STAFF"}});
  await expect(recordSigningBusinessReview(staff.id,review())).rejects.toThrow();
  await expect(recordSigningBusinessReview(owner,{...review(),expectedOrderFingerprint:"f".repeat(64)})).rejects.toThrow(/changed/);
  expect(()=>validateSigningBusinessReview({...review(),confirmedOnKey:"2999-01-01"},new Date())).toThrow();
  await recordSigningBusinessReview(owner,review());
  expect(await prisma.signingBusinessReview.count({where:{orderFingerprint}})).toBe(2);
  const quote=await getPreparedEstimateQuote(estimateId);expect(quote.status).toBe("READY");
  expect(quote.totals?.dueAtSigningCents).toBe(45606);expect(quote.totals?.reserveCents).toBe(15000);
  await sendEstimate(owner,estimateId);
  await expect(approveEstimate(estimateId,{expectedQuoteFingerprint:"f".repeat(64),approverName:"Synthetic Customer",approverEmail:"v2@test.invalid",ipAddress:null})).rejects.toThrow(/changed/);
  await approveEstimate(estimateId,{expectedQuoteFingerprint:quote.quoteFingerprint!,approverName:"Synthetic Customer",approverEmail:"v2@test.invalid",ipAddress:null});
  expect(await createDepositCheckoutSessionForEstimate(estimateId)).toBeNull();
  await convertEstimateToAgreements(owner,estimateId,{mode:"per-property"});
  expect((await convertEstimateToAgreements(owner,estimateId,{mode:"per-property"})).sort()).toEqual([...ids].sort());

  await expect(prisma.signingBusinessReview.updateMany({where:{orderFingerprint},data:{reason:"Cannot rewrite the prior immutable approval"}})).rejects.toThrow(/immutable/);
 });
 it("signs each location, settles exactly once, dispatches only paid A and cancels/refunds only B including reserve",async()=>{
  await recordSigningBusinessReview(owner,{...review(),decision:"REVIEW_REQUIRED",taxAdviserReference:"",legalAdviserReference:"",termsReference:"",confirmedOnKey:""});
  await expect(sendForSignature(owner,ids[0])).rejects.toThrow(/owner-recorded CPA/);
  expect((await prisma.agreementSigningCharge.findUniqueOrThrow({where:{agreementId:ids[0]}})).frozenOrderFingerprint).toBe(orderFingerprint);
  await recordSigningBusinessReview(owner,review());
  for(const id of ids){const sig=await sendForSignature(owner,id);await signAgreement(sig.id,{signerName:"Synthetic Customer",signerEmail:"v2@test.invalid",ipAddress:null});}
  const aJob=await prisma.job.findFirstOrThrow({where:{agreementId:ids[0],type:"DELIVERY"}});
  expect(aJob.scheduledAt).toBeNull();await expect(updateJobStatus(owner,aJob.id,"IN_PROGRESS")).rejects.toThrow(/actually received/);
  for(const [i,id] of ids.entries()){
   const attempt=await prepareSigningPaymentAttempt(id,"MANUAL",owner);
   const input={agreementId:id,attemptId:attempt.id,actingUserId:owner,method:"check" as const,reference:`SYN-${tag}-${i}`,receivedOn:day,confirmedReceived:true};
   const results=await Promise.all([recordManualSigningPayment(input),recordManualSigningPayment(input)]);
   expect(results.map(row=>row.replayed).sort()).toEqual([false,true]);
   const receipt=results[0];expect(receipt.amountCents).toBe(i===0?28631:16975);
   expect((await recordManualSigningPayment(input)).replayed).toBe(true);
   const deposit=await prisma.deposit.findFirstOrThrow({where:{agreementId:id}});
   expect(deposit.sourceReceiptId).toBe(receipt.receiptId);expect(deposit.refundedAt).toBeNull();
   const credit=await prisma.signingDownPaymentCredit.findUniqueOrThrow({where:{agreementId:id}});
   expect(credit.amountCents).toBe(i===0?6000:9500);
   expect(signingFirstInvoiceItem(credit,"prod_synthetic").price_data!.unit_amount).toBe(-credit.amountCents);
  }
  expect((await updateJobStatus(owner,aJob.id,"IN_PROGRESS")).status).toBe("IN_PROGRESS");
  const b=ids[1];const quote=await getPreDeliveryCancellationQuote(b);expect(quote.refundableCents).toBe(16975);
  await approvePreDeliveryCancellation({agreementId:b,actorUserId:owner,expectedFingerprint:quote.fingerprint,policy:"FULL_REFUND",reason:"Synthetic cancellation of undelivered second location",reviewedTerms:true});
  const reserve=await prisma.deposit.findFirstOrThrow({where:{agreementId:b}});expect(reserve.refundedAt).toBeNull();
  await expect(decideDepositRefund(owner,{depositId:reserve.id,refundCents:5000})).rejects.toThrow(/included in the approved cancellation/);
  const returned=await getRefundReturnReview(b);
  await recordExternallyReturnedRefund({agreementId:b,actorUserId:owner,expectedFingerprint:returned.fingerprint,method:"MANUAL_CHECK",reference:`RETURN-${tag}`,confirmedReturned:true});
  expect((await prisma.deposit.findUniqueOrThrow({where:{id:reserve.id}})).refundedAmountCents).toBe(5000);
  expect((await prisma.deposit.findFirstOrThrow({where:{agreementId:ids[0]}})).refundedAt).toBeNull();
  expect((await getRefundReturnReview(b)).refundState).toBe("RETURNED_MANUAL_RECORDED");
  // Real physical delivery commits before the simulated provider first invoice.
  // No real Stripe acceptance is claimed by these synthetic provider objects.
  const a=await prisma.rentalAgreement.findUniqueOrThrow({where:{id:ids[0]},include:{lines:true}});
  await prisma.customer.update({where:{id:a.customerId},data:{stripeCustomerId:"cus_v2_synthetic_"+tag,stripeDefaultPaymentMethodId:"pm_v2_synthetic_"+tag}});
  const type=await prisma.applianceType.findFirstOrThrow();
  const results=[];
  for(let i=0;i<2;i++){
   const line=a.lines[0];
   const machine=await prisma.appliance.create({data:{assetNumber:`V2-${tag}-${i}`,applianceTypeId:type.id,status:"RESERVED"}});
   await prisma.applianceAssignment.create({data:{rentalLineId:line.id,applianceId:machine.id}});
   await prisma.jobAppliance.create({data:{jobId:aJob.id,applianceId:machine.id}});
   results.push({applianceId:machine.id,result:"DELIVERED" as const});
  }
  const job=await prisma.job.findUniqueOrThrow({where:{id:aJob.id}});
  const completion={jobId:aJob.id,expectedVersion:job.version,completionKey:`v2-complete-${tag}`,
    performedOn:businessDateFromKey(day),completionNotes:null,results};
  await completeJob(owner,completion);
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id:a.id}})).firstDeliveredOn).not.toBeNull();
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id:b}})).firstDeliveredOn).toBeNull();
  const application=await prisma.signingFirstInvoiceApplication.findUniqueOrThrow({where:{agreementId:a.id}});
  expect(application.amountCents).toBe(6000);
  expect(provider.params?.add_invoice_items?.[0].price_data?.unit_amount).toBe(-6000);
  expect(provider.calls).toBe(1);
  expect((await completeJob(owner,completion)).replayed).toBe(true);
  await startRecurringBillingForAgreement(a.id);expect(provider.calls).toBe(1);
  expect(await prisma.signingFirstInvoiceApplication.count({where:{agreementId:b}})).toBe(0);

 });
});

// Round-trip the actual V2 signature, receipt, reserve, adviser revisions and
// application through the supported restore command, not hand-written INSERTs.
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildDatabaseBackupSnapshot } from "@/domains/backup";
import { reopenUnsignedSigningOrder } from "@/domains/billing/signing-unsigned-reopen";
it.skipIf(!enabled)("reopens only an untouched unsigned draft and preserves prior frozen evidence for renewed review",async()=>{
 const fixture=await createSyntheticW22V2Order();
 try{
  await recordSigningBusinessReview(fixture.owner,{...review(fixture.ids[0]),expectedOrderFingerprint:fixture.orderFingerprint});
  await expect(reopenUnsignedSigningOrder(fixture.owner,{agreementId:fixture.ids[0],expectedOrderFingerprint:"f".repeat(64),reason:"Synthetic stale reopening must not change draft"})).rejects.toThrow(/changed/);
  const before=await prisma.agreementSigningCharge.findUniqueOrThrow({where:{agreementId:fixture.ids[0]}});
  await reopenUnsignedSigningOrder(fixture.owner,{agreementId:fixture.ids[0],expectedOrderFingerprint:fixture.orderFingerprint,reason:"Synthetic changed policy requires new order review"});
  const after=await prisma.agreementSigningCharge.findUniqueOrThrow({where:{agreementId:fixture.ids[0]}});
  expect(after.frozenAt).toBeNull();expect(after.version).toBe(before.version+1);
  expect(await prisma.signingBusinessReview.count({where:{orderFingerprint:fixture.orderFingerprint}})).toBe(2);
  const audit=await prisma.auditLog.findFirstOrThrow({where:{entityId:fixture.ids[0],action:"signing.unsigned_order_reopened"}});
  expect(JSON.stringify(audit.oldValue)).toContain(fixture.orderFingerprint);
  await expect(reopenUnsignedSigningOrder(owner,{agreementId:ids[0],expectedOrderFingerprint:orderFingerprint,reason:"Signed orders cannot use the unsigned reopening path"})).rejects.toThrow();
 }finally{await fixture.cleanup();}
});

it.skipIf(!enabled)("restores complete V2 financial history and source-trigger ordering",async()=>{
 const database="appliance_desk_restore_v2_"+tag.slice(0,16);
 const adminUrl=new URL(process.env.DATABASE_URL!);adminUrl.pathname="/postgres";
 const restoreUrl=new URL(process.env.DATABASE_URL!);restoreUrl.pathname="/"+database;
 const admin=new Client({connectionString:adminUrl.toString()});await admin.connect();
 const dir=await mkdtemp(path.join(tmpdir(),"w22-v2-restore-"));
 let restored:PrismaClient|undefined;
 try{
  await admin.query('CREATE DATABASE "'+database+'"');
  const snapshot=await buildDatabaseBackupSnapshot();
  const file=path.join(dir,"synthetic-backup.json");await writeFile(file,JSON.stringify(snapshot.payload));
  await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/restore-backup.ts",file,"--into",restoreUrl.toString()],
    {timeout:120_000,maxBuffer:2*1024*1024});
  restored=new PrismaClient({adapter:new PrismaPg({connectionString:restoreUrl.toString()})});
  expect(await restored.signingBusinessReview.count({where:{orderFingerprint}})).toBeGreaterThanOrEqual(2);
  expect((await restored.agreementSigningPayment.findUniqueOrThrow({where:{agreementId:ids[0]}})).totalCents).toBe(28631);
  expect((await restored.deposit.findFirstOrThrow({where:{agreementId:ids[1]}})).refundedAmountCents).toBe(5000);
  expect((await restored.signingFirstInvoiceApplication.findUniqueOrThrow({where:{agreementId:ids[0]}})).amountCents).toBe(6000);
  await expect(restored.signingBusinessReview.updateMany({where:{orderFingerprint},data:{reason:"Restored history must remain immutable"}})).rejects.toThrow(/immutable/);
 }finally{
  await restored?.$disconnect();await admin.query('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)');
  await admin.end();await rm(dir,{recursive:true,force:true});
 }
},120_000);
