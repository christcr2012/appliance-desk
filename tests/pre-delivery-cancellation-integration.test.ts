import { randomUUID, createHash } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
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
 async function make(paid:boolean,pending=false){
  const id="w22c-"+ids.length+"-"+key;ids.push(id);
  await prisma.rentalAgreement.create({data:{id,customerId:customer,serviceAddressId:address,status:"ACTIVE",startDate:new Date(Date.now()-24*3600000),lines:{create:[{label:"Washer and dryer",monthlyPriceCents:6000,listPriceCents:6000}]}}});
  const receipt=paid?await prisma.receipt.create({data:{
    customerId:customer,source:"MANUAL",amountCents:10500,method:"check",receivedOn:new Date(Date.now()-24*3600000),
    recordedByUserId:actor,
  }}):null;
  await prisma.agreementSigningPayment.create({data:{
    agreementId:id,orderFingerprint:createHash("sha256").update(id).digest("hex"),evidenceVersion:1,setupFeeCents:4500,
    setupTaxCents:0,downPaymentCents:6000,totalCents:10500,
    status:paid?"SETTLED":"AWAITING_PAYMENT",signedAt:new Date(Date.now()-24*3600000),
    receiptId:receipt?.id,settledAt:paid?new Date(Date.now()-24*3600000):null,
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
 it("refuses unresolved provider collection without cancelling",async()=>{
  const id=await make(false,true);
  await expect(getPreDeliveryCancellationQuote(id)).rejects.toThrow(/pending or unverified/);
  expect((await prisma.rentalAgreement.findUniqueOrThrow({where:{id}})).status).toBe("ACTIVE");
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
