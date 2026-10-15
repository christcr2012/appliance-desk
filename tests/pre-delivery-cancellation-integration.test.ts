import { randomUUID, createHash } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { buildSignedCancellationPolicyEvidence } from "@/domains/agreements/signed-cancellation-policy";
import { prisma } from "@/lib/prisma";
import { cancelAgreement } from "@/domains/agreements";
import { approvePreDeliveryCancellation,getPreDeliveryCancellationQuote } from "@/domains/agreements/pre-delivery-cancellation";
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:async()=>({user:{id:actor,role:"OWNER",archivedAt:null}})}}}));
vi.mock("@/domains/security/two-factor",()=>({twoFactorEnrollmentRequired:async()=>false}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
const target=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(target.hostname)&&target.pathname==="/appliance_desk_test";
const key=randomUUID().replaceAll("-","");
const actor="w22c-owner-"+key;
const customerUser="w22c-user-"+key;
const customer="w22c-customer-"+key;
const address="w22c-address-"+key;
const ids:string[]=[];
describe.skipIf(!enabled)("W-22 approved before-delivery cancellations (disposable PostgreSQL)",()=>{
 beforeAll(async()=>{
  await prisma.user.createMany({data:[
    {id:actor,email:"w22c-owner-"+key+"@test.invalid",role:"OWNER",emailVerified:true},
    {id:customerUser,email:"w22c-customer-"+key+"@test.invalid",role:"CUSTOMER",emailVerified:true},
  ]});
  await prisma.customer.create({data:{id:customer,userId:customerUser,referralCode:"CC"+key.slice(0,16)}});
  await prisma.serviceAddress.create({data:{id:address,customerId:customer,line1:"1 Review Test Way",city:"Greeley",state:"CO",zip:"80631"}});
 });
 async function make(paid:boolean,pending=false, options?:{
   signedPolicy?:boolean; prepaid?:boolean; machineCount?:number;
   businessCustomer?:boolean; signedDaysAgo?:number;
  }){
  const id="w22c-"+ids.length+"-"+key;ids.push(id);
  const signedAt=new Date(Date.now()-(options?.signedDaysAgo??1)*24*3600000);
  const paidCents=options?.prepaid?4500:10500;
  const advanceCents=options?.prepaid?0:6000;
  const fingerprint=createHash("sha256").update(id).digest("hex");
  const signedPolicy=options?.signedPolicy?buildSignedCancellationPolicyEvidence({
   agreementId:id,orderFingerprint:fingerprint,signedAt,
   settings:{largeOrderMachineThreshold:5,largeOrderCancellationFullRefundHours:72,
    updatedAt:new Date("2026-10-12T12:00:00.000Z")},
   machines:[{agreementId:id,machineCount:options.machineCount??1}],
   businessCustomer:options.businessCustomer??false,propertyManagerCustomer:false,
  }):null;
  await prisma.rentalAgreement.create({data:{id,customerId:customer,serviceAddressId:address,status:"ACTIVE",
   paidInFullInAdvance:options?.prepaid??false,
   startDate:new Date(Date.now()-24*3600000),lines:{create:[{label:"Washer and dryer",monthlyPriceCents:6000,listPriceCents:6000}]}}});
  const receipt=paid?await prisma.receipt.create({data:{
    customerId:customer,source:"MANUAL",amountCents:paidCents,method:"check",receivedOn:signedAt,
    recordedByUserId:actor,
  }}):null;
  await prisma.agreementSigningPayment.create({data:{
    agreementId:id,orderFingerprint:fingerprint,evidenceVersion:1,setupFeeCents:4500,
    setupTaxCents:0,downPaymentCents:advanceCents,totalCents:paidCents,
    status:paid?"SETTLED":"AWAITING_PAYMENT",signedAt,
    ...(signedPolicy?{cancellationPolicyEvidence:signedPolicy as unknown as Prisma.InputJsonValue}:{}),
    receiptId:receipt?.id,settledAt:paid?signedAt:null,
  }});
  if(pending)await prisma.signingPaymentAttempt.create({data:{
    agreementId:id,requestKey:"pending-"+id,attemptNumber:1,method:"STRIPE_CHECKOUT",status:"PENDING",
    orderFingerprint:createHash("sha256").update(id).digest("hex"),amountCents:10500,
  }});
  return id;
 }
 it("records explicit full refund liability and closes custody without sending money",async()=>{
  const id=await make(true);
  await expect(cancelAgreement(actor,id)).rejects.toThrow(/refund review/);
  const before=await getPreDeliveryCancellationQuote(id);
  expect(before.refundableCents).toBe(10500);
  await expect(approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,
    expectedFingerprint:before.fingerprint,policy:"FULL_REFUND",
    reason:"Customer requested cancellation before delivery",reviewedTerms:false
  })).rejects.toThrow(/Review/);
  await approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,
    expectedFingerprint:before.fingerprint,policy:"FULL_REFUND",
    reason:"Customer requested cancellation before delivery",reviewedTerms:true
  });
  const [agreement,record,refunds]=await Promise.all([
    prisma.rentalAgreement.findUniqueOrThrow({where:{id}}),
    prisma.preDeliveryCancellation.findUniqueOrThrow({where:{agreementId:id}}),
    prisma.refund.count(),
  ]);
  expect(agreement.status).toBe("CANCELLED");
  expect(record).toMatchObject({receiptId:before.receiptId,refundDueCents:10500,retainedCents:0,
    refundState:"PENDING_EXTERNAL_REFUND",approvedByUserId:actor,reviewedTerms:true});
  expect(refunds).toBe(0);
  await expect(approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,
    expectedFingerprint:before.fingerprint,policy:"FULL_REFUND",
    reason:"Duplicate cancellation must not run again",reviewedTerms:true
  })).rejects.toThrow();
  expect(await prisma.preDeliveryCancellation.count({where:{agreementId:id}})).toBe(1);
 });
 it("synthetic prepaid-mode five-machine zero-advance signing payment retains setup under its frozen window",async()=>{
  const id=await make(true,false,{signedPolicy:true,prepaid:true,machineCount:5,signedDaysAgo:4});
  const quote=await getPreDeliveryCancellationQuote(id);
  expect(quote).toMatchObject({signingAmountCents:4500,largeOrder:true,
   policyEvidenceStatus:"SIGNED",fullRefundHours:72,
   defaultPolicy:"RETAIN_SETUP",refundableCents:0,retainedCents:4500});
  await approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,
   expectedFingerprint:quote.fingerprint,policy:"RETAIN_SETUP",
   reason:"Owner reviewed original signed prepaid large-order terms",
   reviewedTerms:true});
  const saved=await prisma.preDeliveryCancellation.findUniqueOrThrow({where:{agreementId:id}});
  expect(saved).toMatchObject({signedAmountCents:4500,refundDueCents:0,retainedCents:4500,
   refundState:"NOT_REQUIRED"});
  expect(saved.signedPolicyEvidence).toMatchObject({largeOrder:true,reasons:["MACHINE_THRESHOLD"]});
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id}})).status).toBe("CANCELLED");
 });
 it("an original business order with one appliance remains large without an advance",async()=>{
  const id=await make(true,false,{signedPolicy:true,prepaid:true,
   machineCount:1,businessCustomer:true,signedDaysAgo:4});
  const quote=await getPreDeliveryCancellationQuote(id);
  expect(quote).toMatchObject({largeOrder:true,defaultPolicy:"RETAIN_SETUP",
   policyEvidenceStatus:"SIGNED"});
  expect(quote.largeOrderReasons).toContain("BUSINESS_CUSTOMER");
 });
 it("historical obligations without signed policy never acquire today's retention rule",async()=>{
  const id=await make(true);
  const quote=await getPreDeliveryCancellationQuote(id);
  expect(quote).toMatchObject({policyEvidenceStatus:"LEGACY_UNVERIFIED",
   defaultPolicy:"FULL_REFUND",signingAmountCents:10500});
  await expect(approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,
   expectedFingerprint:quote.fingerprint,policy:"RETAIN_SETUP",
   reason:"Attempt to apply new policy to an older signature",reviewedTerms:true
  })).rejects.toThrow(/full signing payment/);
  expect(await prisma.preDeliveryCancellation.count({where:{agreementId:id}})).toBe(0);
 });
 it("database denies rewriting the frozen signed policy after signing",async()=>{
  const id=await make(true,false,{signedPolicy:true,machineCount:5});
  const before=await prisma.agreementSigningPayment.findUniqueOrThrow({where:{agreementId:id}});
  await expect(prisma.agreementSigningPayment.update({where:{agreementId:id},
   data:{cancellationPolicyEvidence:{schemaVersion:1,largeOrder:false}}
  })).rejects.toThrow();
  const after=await prisma.agreementSigningPayment.findUniqueOrThrow({where:{agreementId:id}});
  expect(after.cancellationPolicyEvidence).toEqual(before.cancellationPolicyEvidence);
 });
 it("refuses unresolved provider collection without cancelling",async()=>{
  const id=await make(false,true);
  await expect(getPreDeliveryCancellationQuote(id)).rejects.toThrow(/pending or unverified/);
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id}})).status).toBe("ACTIVE");
 });
 it.each(["PREPARED", "PENDING", "SUCCEEDED"])("generic and reviewed cancellation both deny unreconciled %s collection",async status=>{
  const id=await make(false,true);
  await prisma.signingPaymentAttempt.updateMany({where:{agreementId:id},data:{status}});
  await expect(cancelAgreement(actor,id)).rejects.toThrow(/Reconcile/);
  await expect(getPreDeliveryCancellationQuote(id)).rejects.toThrow(/Reconcile/);
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id}})).status).toBe("ACTIVE");
  expect(await prisma.preDeliveryCancellation.count({where:{agreementId:id}})).toBe(0);
  expect(await prisma.receipt.count({where:{customerId:customer,
    signingPaymentObligation:{agreementId:id}}})).toBe(0);
 });
 it("reads an attempt committed while cancellation waits on its obligation lock",async()=>{
  const id=await make(false);
  let release!:()=>void;
  let acquired!:()=>void;
  const held=new Promise<void>(resolve=>{acquired=resolve;});
  const unlock=new Promise<void>(resolve=>{release=resolve;});
  const preparing=prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "agreementId" FROM "AgreementSigningPayment" WHERE "agreementId" = ${id} FOR UPDATE`;
   await tx.signingPaymentAttempt.create({data:{agreementId:id,requestKey:"race-"+id,
    attemptNumber:1,method:"STRIPE_CHECKOUT",status:"PENDING",amountCents:10500,
    orderFingerprint:createHash("sha256").update(id).digest("hex")}});
   acquired();
   await unlock;
  });
  await held;
  const cancelling=cancelAgreement(actor,id);
  let waiting=false;
  try {
   for(let i=0;i<50&&!waiting;i++) {
    const [state]=await prisma.$queryRaw<Array<{waiting:boolean}>>`
     SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
       AND query LIKE '%AgreementSigningPayment%' AND pid<>pg_backend_pid()) AS waiting`;
    waiting=state.waiting;
    if(!waiting)await new Promise(resolve=>setTimeout(resolve,20));
   }
  } finally { release(); }
  const results=await Promise.allSettled([preparing,cancelling]);
  expect(waiting).toBe(true);
  expect(results[0].status).toBe("fulfilled");
  expect(results[1].status).toBe("rejected");
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id}})).status).toBe("ACTIVE");
  expect(await prisma.preDeliveryCancellation.count({where:{agreementId:id}})).toBe(0);
 });
 it("settled signing money with an additional pending collection is not safely cancellable",async()=>{
  const id=await make(true,true);
  await expect(cancelAgreement(actor,id)).rejects.toThrow(/Reconcile/);
  await expect(getPreDeliveryCancellationQuote(id)).rejects.toThrow(/Reconcile/);
  expect(await prisma.preDeliveryCancellation.count({where:{agreementId:id}})).toBe(0);
 });
 it("does not treat an unpaid agreement as received money",async()=>{
  const id=await make(false);
  const quote=await getPreDeliveryCancellationQuote(id);
  expect(quote).toMatchObject({receiptId:null,signingAmountCents:0,refundableCents:0,refundState:"NOT_REQUIRED"});
  await approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,expectedFingerprint:quote.fingerprint,
    policy:"FULL_REFUND",reason:"Customer withdrew before paying for this rental",reviewedTerms:true});
  expect(await prisma.preDeliveryCancellation.findUniqueOrThrow({where:{agreementId:id}}))
    .toMatchObject({refundDueCents:0,refundState:"NOT_REQUIRED"});
 });
 it("denies stale financial reviews after a verified amount changes",async()=>{
  const id=await make(false);
  const before=await getPreDeliveryCancellationQuote(id);
  await prisma.agreementSigningPayment.update({where:{agreementId:id},data:{orderFingerprint:createHash("sha256").update(id+"changed").digest("hex")}});
  await expect(approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,expectedFingerprint:before.fingerprint,
    policy:"FULL_REFUND",reason:"Customer requested cancellation after charge changed",reviewedTerms:true
  })).rejects.toThrow(/Refresh/);
  expect(await prisma.preDeliveryCancellation.count({where:{agreementId:id}})).toBe(0);
 });
 it("owner independently records a completed manual return",async()=>{
  const id=await make(true);
  const approved=await getPreDeliveryCancellationQuote(id);
  await approvePreDeliveryCancellation({agreementId:id,actorUserId:actor,
   expectedFingerprint:approved.fingerprint,policy:"FULL_REFUND",
   reason:"Customer cancelled before delivery",reviewedTerms:true});
  const {getRefundReturnReview,recordExternallyReturnedRefund}=await import(
   "@/domains/agreements/pre-delivery-refund-return");
  const before=await getRefundReturnReview(id);
  expect(before.refundState).toBe("PENDING_EXTERNAL_REFUND");
  await expect(recordExternallyReturnedRefund({
   agreementId:id,actorUserId:actor,expectedFingerprint:before.fingerprint,
   method:"MANUAL_CHECK",reference:"CHECK-"+id,confirmedReturned:false,
  })).rejects.toThrow();
  const result=await recordExternallyReturnedRefund({
   agreementId:id,actorUserId:actor,expectedFingerprint:before.fingerprint,
   method:"MANUAL_CHECK",reference:"CHECK-"+id,confirmedReturned:true,
  });
  expect(result.refundState).toBe("RETURNED_MANUAL_RECORDED");
  const stored=await prisma.preDeliveryCancellation.findUniqueOrThrow({where:{agreementId:id}});
  expect(stored).toMatchObject({refundDueCents:10500,refundMethod:"MANUAL_CHECK",
   refundReference:"CHECK-"+id,returnedByUserId:actor});
  const {listCancellationRefundAttention}=await import(
   "@/domains/exceptions/cancellation-refund-attention");
  expect((await listCancellationRefundAttention(50)).rows.some(x=>x.href.endsWith(id+"/refund"))).toBe(false);
  await expect(recordExternallyReturnedRefund({
   agreementId:id,actorUserId:actor,expectedFingerprint:before.fingerprint,
   method:"MANUAL_CHECK",reference:"CHECK-"+id,confirmedReturned:true,
  })).rejects.toThrow();
 });
 afterAll(async()=>{
  await prisma.signingPaymentAttempt.deleteMany({where:{agreementId:{in:ids}}});
  await prisma.preDeliveryCancellation.deleteMany({where:{agreementId:{in:ids}}});
  await prisma.agreementSigningPayment.deleteMany({where:{agreementId:{in:ids}}});
  await prisma.receipt.deleteMany({where:{customerId:customer}});
  await prisma.auditLog.deleteMany({where:{OR:[{userId:actor},{entityId:{in:ids}}]}});
  await prisma.rentalLine.deleteMany({where:{agreementId:{in:ids}}});
  await prisma.rentalAgreement.deleteMany({where:{id:{in:ids}}});
  await prisma.serviceAddress.deleteMany({where:{id:address}});
  await prisma.customer.deleteMany({where:{id:customer}});
  await prisma.user.deleteMany({where:{id:{in:[actor,customerUser]}}});
 });
});
