import { getDraftSigningTaxReviewInTx } from "@/domains/billing/signing-charge-tax-review";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { seedTaxReadyContext } from "./helpers/tax-ready";
import { nextCommercialReserveRevision } from "@/domains/estimates/commercial-reserve-policy";
import { nextMandatoryChargeReview } from "@/domains/billing/mandatory-charge-review";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";
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
const tag=randomUUID().replaceAll("-","");
const day=businessDateKey(new Date());
let previousPolicy:Prisma.JsonValue;
let previousElection:string;
let taxDecisionId="";
const ids:string[]=[];
const cleanups:Array<()=>Promise<void>>=[];
let orderFingerprint="";
const review=(agreementId=ids[0],decision:"APPROVED"|"REVIEW_REQUIRED"="APPROVED")=>({
  agreementId,expectedOrderFingerprint:orderFingerprint,decision,
  effectiveFromKey:day,confirmedOnKey:day,taxAdviserReference:"Synthetic CPA advice for isolated test only",
  legalAdviserReference:"Synthetic attorney advice for isolated test only",termsReference:"Synthetic complete signing and refund terms",
  reason:"Synthetic owner attestation; no actual professional approval",acknowledged:true,
});
describe.skipIf(!enabled)("V2 two-address sign, settlement, reserve, cancellation and dispatch (disposable Postgres)",()=>{
 beforeAll(async()=>{
  owner=(await prisma.user.findFirstOrThrow({where:{role:"OWNER"}})).id;
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  previousPolicy=settings.signingMandatoryPolicyVersions;previousElection=settings.shortTermLeaseElection;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   signingMandatoryPolicyVersions:[{revision:1,effectiveFromKey:day,recordedAt:new Date().toISOString(),recordedByUserId:owner,
    reason:"Synthetic isolated mandatory categories",decisions:{delivery:"REQUIRED",installation:"NOT_APPLICABLE",removal:"NOT_APPLICABLE",damageWaiver:"NOT_APPLICABLE",retailDelivery:"REQUIRED"}}],
  }});
  taxDecisionId=(await prisma.setupFeeTaxDecisionVersion.create({data:{treatment:"TAXABLE",effectiveFromKey:day,cpaConfirmedOnKey:day,
   decisionNote:"Synthetic taxable setup test decision",adviserReference:"Synthetic CPA test fixture only",ownerUserId:owner}})).id;
  const user=await prisma.user.create({data:{email:`v2-flow-${tag}@test.invalid`,role:"CUSTOMER",emailVerified:true}});
  const customer=await prisma.customer.create({data:{userId:user.id,referralCode:`V2-${tag}`,isBusiness:true}});
  const estimate=await prisma.estimate.create({data:{customerId:customer.id,title:"Synthetic V2 two property",createdByUserId:owner,depositCents:15000}});
  const sources=[];
  const now=new Date();
  for(let i=0;i<2;i++){
   const address=await prisma.serviceAddress.create({data:{customerId:customer.id,line1:`${i+1} Synthetic V2 Way`,city:"Greeley",zip:"80631"}});
   const tax=await seedTaxReadyContext(address.id,{rateMilliPercent:i===0?5000:10000});cleanups.push(tax.cleanup);
   await prisma.taxabilityRule.update({where:{jurisdictionId_category:{jurisdictionId:tax.jurisdictionId,category:"ADMINISTRATIVE_SETUP"}},data:{cpaConfirmedOn:new Date("2020-01-01T00:00:00Z"),updatedByUserId:owner}});
   const agreement=await prisma.rentalAgreement.create({data:{customerId:customer.id,serviceAddressId:address.id,sourceEstimateId:estimate.id,
    depositCents:i===0?10000:5000}});ids.push(agreement.id);
   const reserve=nextCommercialReserveRevision({previous:[],estimateId:estimate.id,agreementId:agreement.id,amountCents:agreement.depositCents,
    replenishment:"QUARTERLY",termsReference:"Synthetic negotiated reserve terms",actorUserId:owner,reason:"Synthetic reserve terms for isolated proof",recordedAt:now});
   const rent=i===0?6000:9500;const setup=i===0?4500:2250;const delivery=i===0?7500:0;
   await prisma.rentalLine.createMany({data:Array.from({length:i===0?2:3},(_,n)=>({agreementId:agreement.id,label:`Machine ${n+1}`,
    monthlyPriceCents:i===0?3000:n===2?3500:3000,listPriceCents:i===0?3000:n===2?3500:3000}))});
   sources.push({agreement,address,tax,reserve,rent,setup,delivery});
  }
  // All review/snapshot sources share the final singleton revision after tax fixture setup.
  const current=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  for(const [i,x] of sources.entries()){
   const mandatory=nextMandatoryChargeReview({previous:[],revision:{
    estimateId:estimate.id,agreementId:x.agreement.id,serviceAddressId:x.address.id,actorUserId:owner,recordedAt:now.toISOString(),
    reason:"Synthetic reviewed all-in category allocation",globalPolicyRevision:1,settingsUpdatedAt:current.updatedAt.toISOString(),
    charges:[{kind:"delivery",amountCents:x.delivery,decision:x.delivery?"REQUIRED":"NOT_APPLICABLE",reason:null},
     {kind:"installation",amountCents:0,decision:"NOT_APPLICABLE",reason:null},{kind:"removal",amountCents:0,decision:"NOT_APPLICABLE",reason:null},
     {kind:"damageWaiver",amountCents:0,decision:"NOT_APPLICABLE",reason:null}],
    tax:{status:"VERIFIED",taxCents:i===0?375:0,reasons:[],lines:i===0?[{lineKey:"mandatory:delivery",jurisdictionId:x.tax.jurisdictionId,
     rateVersionId:x.tax.rateVersionId,category:"DELIVERY",taxableCents:7500,exemptCents:0,taxCents:375}]:[]},
    retailDelivery:{event:i===0,status:i===0?"APPLIES":"EXEMPT",amountCents:i===0?31:0,rateId:i===0?"synthetic-rdf":null,
     handling:"COLLECT_FROM_CUSTOMER",reason:"Synthetic single event allocation only"},reserveCents:x.agreement.depositCents,reserveRevision:1,
   }});
   await prisma.rentalAgreement.update({where:{id:x.agreement.id},data:{commercialReservePolicyVersions:x.reserve.versions,mandatoryChargeReviewVersions:mandatory.versions}});
   await prisma.agreementSigningCharge.create({data:{agreementId:x.agreement.id,sourceEstimateId:estimate.id,serviceAddressId:x.address.id,
    machineCount:i===0?2:3,firstMonthRentCents:x.rent,setupFeeCents:x.setup,downPaymentCents:x.rent,signingSubtotalCents:x.setup+x.rent,
    setupFeeTaxTreatment:"TAXABLE",settingsUpdatedAt:current.updatedAt,sourceFingerprint:"e".repeat(64),createdByUserId:owner}});
  }
  const prepared=await prisma.$transaction(tx=>getDraftSigningTaxReviewInTx(tx,ids[0],new Date()));
  expect(prepared.reasons).toEqual([]);
  orderFingerprint=(await freezeReviewedSigningOrder(owner,ids[0])).orderFingerprint;
 });
 afterAll(async()=>{
  // Immutable financial fixtures intentionally survive until this throwaway cluster
  // is destroyed. Restore shared policy only; never truncate another spec's rows.
  if(previousPolicy!==undefined)await prisma.businessSettings.update({where:{id:"singleton"},data:{signingMandatoryPolicyVersions:previousPolicy as Prisma.InputJsonValue,shortTermLeaseElection:previousElection}});
  if(taxDecisionId)await prisma.setupFeeTaxDecisionVersion.delete({where:{id:taxDecisionId}});
 });
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
  await expect(prisma.signingBusinessReview.updateMany({where:{orderFingerprint},data:{reason:"Cannot rewrite the prior immutable approval"}})).rejects.toThrow(/immutable/);
 });
 it("signs each location, settles exactly once, dispatches only paid A and cancels/refunds only B including reserve",async()=>{
  for(const id of ids){const sig=await sendForSignature(owner,id);await signAgreement(sig.id,{signerName:"Synthetic Customer",signerEmail:"v2@test.invalid",ipAddress:null});}
  const aJob=await prisma.job.findFirstOrThrow({where:{agreementId:ids[0],type:"DELIVERY"}});
  expect(aJob.scheduledAt).toBeNull();await expect(updateJobStatus(owner,aJob.id,"IN_PROGRESS")).rejects.toThrow(/actually received/);
  for(const [i,id] of ids.entries()){
   const attempt=await prepareSigningPaymentAttempt(id,"MANUAL",owner);
   const input={agreementId:id,attemptId:attempt.id,actingUserId:owner,method:"check" as const,reference:`SYN-${tag}-${i}`,receivedOn:day,confirmedReceived:true};
   const receipt=await recordManualSigningPayment(input);expect(receipt.amountCents).toBe(i===0?28631:16975);
   expect((await recordManualSigningPayment(input)).replayed).toBe(true);
   const deposit=await prisma.deposit.findFirstOrThrow({where:{agreementId:id}});
   expect(deposit.sourceReceiptId).toBe(receipt.receiptId);expect(deposit.refundedAt).toBeNull();
   const credit=await prisma.signingDownPaymentCredit.findUniqueOrThrow({where:{agreementId:id}});
   expect(credit.amountCents).toBe(i===0?6000:9500);
   expect(signingFirstInvoiceItem(credit,"prod_synthetic").price_data.unit_amount).toBe(-credit.amountCents);
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
 });
});
