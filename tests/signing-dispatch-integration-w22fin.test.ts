import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateJobStatus } from "@/domains/jobs";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";
import { sendForSignature } from "@/domains/agreements";
import { signAgreementAction } from "@/app/sign/[id]/actions";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { recordManualSigningPayment } from "@/domains/billing/signing-payment-manual";
import { seedTaxReadyContext } from "./helpers/tax-ready";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(async () => false) }));
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost","127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("W-22FIN real settled-money-before-dispatch on disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  let ownerId:string, userId:string, customerId:string, addressId:string, agreementId:string, jobId:string;
  let cleanupTax:(()=>Promise<void>)|null = null;
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where:{ role:"OWNER" } })).id;
    userId = (await prisma.user.create({data:{
      email:"w22-dispatch-"+tag+"@test.invalid",role:"CUSTOMER",emailVerified:true,
    }})).id;
    customerId = (await prisma.customer.create({data:{
      userId,referralCode:"DW"+tag.slice(0,15),
    }})).id;
    addressId = (await prisma.serviceAddress.create({data:{
      customerId,line1:"18 Real Signing St",city:"Greeley",zip:"80631",
    }})).id;
    const tax = await seedTaxReadyContext(addressId);
    cleanupTax = tax.cleanup;
    agreementId = (await prisma.rentalAgreement.create({data:{customerId,serviceAddressId:addressId}})).id;
    await prisma.rentalLine.createMany({data:Array.from({length:5},(_,n)=>({
      agreementId,label:"Washer "+(n+1),monthlyPriceCents:700,listPriceCents:700,
    }))});
    await prisma.agreementSigningCharge.create({data:{
      agreementId,serviceAddressId:addressId,version:1,machineCount:5,
      firstMonthRentCents:3500,setupFeeCents:0,downPaymentCents:3500,
      signingSubtotalCents:3500,setupFeeTaxTreatment:"UNDECIDED",
      settingsUpdatedAt:new Date(),sourceFingerprint:"d".repeat(64),createdByUserId:ownerId,
    }});
    expect((await freezeReviewedSigningOrder(ownerId,agreementId)).status).toBe("FROZEN");
    const sig=await sendForSignature(ownerId,agreementId);
    expect(await signAgreementAction(sig.id,{
      signerName:"Dispatch Customer",signerEmail:"dispatch@example.test",agreedToTerms:true,
    })).toMatchObject({status:"success",pendingSigningAmountCents:3500});
    const job=await prisma.job.findFirstOrThrow({where:{
      agreementId,type:"DELIVERY",status:"SCHEDULED",
    },select:{id:true,scheduledAt:true}});
    expect(job.scheduledAt).toBeNull();
    jobId=job.id;
  });
  afterAll(async () => {
    if(!agreementId)return;
    if(process.env.DATABASE_URL?.includes("/appliance_desk_test")){
      await prisma.$executeRaw`TRUNCATE TABLE "SigningFirstInvoiceApplication", "SigningDownPaymentCredit"`;
    }
    await prisma.signingPaymentAttempt.deleteMany({where:{agreementId}});
    await prisma.agreementSigningPayment.deleteMany({where:{agreementId}});
    await prisma.receipt.deleteMany({where:{customerId}});
    await prisma.auditLog.deleteMany({where:{OR:[
      {entityType:"Job",entityId:jobId},
      {entityType:"RentalAgreement",entityId:agreementId},
    ]}});
    await prisma.signatureRecord.deleteMany({where:{agreementId}});
    await prisma.agreementSigningCharge.deleteMany({where:{agreementId}});
    await prisma.rentalLine.deleteMany({where:{agreementId}});
    await prisma.job.deleteMany({where:{agreementId}});
    await prisma.rentalAgreement.deleteMany({where:{id:agreementId}});
    await cleanupTax?.();
    await prisma.serviceAddress.deleteMany({where:{id:addressId}});
    await prisma.customer.deleteMany({where:{id:customerId}});
    await prisma.user.deleteMany({where:{id:userId}});
  });
  it("denies unsigned money state and merely prepared payment attempts without changing the job",async()=>{
    await expect(updateJobStatus(ownerId,jobId,"IN_PROGRESS")).rejects.toThrow(/actually received/i);
    expect(await prepareSigningPaymentAttempt(agreementId,"MANUAL",ownerId))
      .toMatchObject({status:"PREPARED",amountCents:3500});
    await expect(updateJobStatus(ownerId,jobId,"IN_PROGRESS")).rejects.toThrow(/actually received/i);
    expect((await prisma.job.findUniqueOrThrow({where:{id:jobId}})).status).toBe("SCHEDULED");
  });
  it("requires legitimate OWNER recording and permits one start only after exact receipt",async()=>{
    const attempt=await prepareSigningPaymentAttempt(agreementId,"MANUAL",ownerId);
    const payment={agreementId,attemptId:attempt.id,actingUserId:ownerId,
      method:"check" as const,reference:"CHK-"+tag.slice(0,12),
      receivedOn:"2026-10-14",confirmedReceived:true};
    await expect(recordManualSigningPayment({...payment,actingUserId:userId})).rejects.toThrow();
    await expect(updateJobStatus(ownerId,jobId,"IN_PROGRESS")).rejects.toThrow(/actually received/i);
    const paid=await recordManualSigningPayment(payment);
    expect(paid.amountCents).toBe(3500);
    const ob=await prisma.agreementSigningPayment.findUniqueOrThrow({
      where:{agreementId},include:{receipt:true},
    });
    expect(ob.status).toBe("SETTLED");
    expect(ob.receipt).toMatchObject({id:paid.receiptId,customerId,amountCents:3500});
    expect((await updateJobStatus(ownerId,jobId,"IN_PROGRESS")).status).toBe("IN_PROGRESS");
    await expect(updateJobStatus(ownerId,jobId,"IN_PROGRESS")).rejects.toThrow(/already/i);
    expect(await prisma.auditLog.count({where:{
      action:"job.status",entityType:"Job",entityId:jobId,
    }})).toBe(1);
    expect(await prisma.invoice.count({where:{agreementId}})).toBe(0);
  });
});
