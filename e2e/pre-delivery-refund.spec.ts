import fs from "node:fs";
import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const ownerState="e2e/.auth/owner.json";
const staffState="e2e/.auth/staff.json";
const customerState="e2e/.auth/customer.json";
const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&db.pathname==="/appliance_desk_test";
test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
test("owner reconciles a separately returned check; other roles denied",async({page,browser})=>{
 test.skip(!enabled,"Disposable PostgreSQL and saved owner session required.");
 for(const f of [ownerState,staffState,customerState])expect(fs.existsSync(f),f).toBe(true);
 const {prisma}=await import("../src/lib/prisma");
 const user=await prisma.user.findUniqueOrThrow({
  where:{email:process.env.TEST_CUSTOMER_EMAIL!.toLowerCase()}});
 const owner=await prisma.user.findFirstOrThrow({where:{role:"OWNER"}});
 const customer=await prisma.customer.findUniqueOrThrow({where:{userId:user.id}});
 const address=await prisma.serviceAddress.create({data:{
  customerId:customer.id,line1:"23 External Refund Test Ave",city:"Greeley",state:"CO",zip:"80631"}});
 const agreement=await prisma.rentalAgreement.create({data:{
  customerId:customer.id,serviceAddressId:address.id,status:"CANCELLED",closedAt:new Date()}});
 const receipt=await prisma.receipt.create({data:{
  customerId:customer.id,source:"MANUAL",amountCents:10500,
  method:"check",receivedOn:new Date(),recordedByUserId:owner.id}});
 const fp=createHash("sha256").update(agreement.id).digest("hex");
 await prisma.agreementSigningPayment.create({data:{
  agreementId:agreement.id,orderFingerprint:fp,evidenceVersion:1,
  setupFeeCents:4500,setupTaxCents:0,downPaymentCents:6000,totalCents:10500,
  status:"SETTLED",signedAt:new Date(Date.now()-3600000),
  receiptId:receipt.id,settledAt:new Date(Date.now()-3600000),
 }});
 await prisma.preDeliveryCancellation.create({data:{
  agreementId:agreement.id,receiptId:receipt.id,orderFingerprint:fp,
  policy:"FULL_REFUND",signedAmountCents:10500,refundDueCents:10500,
  retainedCents:0,reason:"Customer cancelled before delivery",
  reviewedTerms:true,approvedByUserId:owner.id,
  approvedAt:new Date(Date.now()-30000),refundState:"PENDING_EXTERNAL_REFUND",
 }});
 const url="/desk/agreements/"+agreement.id+"/refund";
 try{
  await page.goto(url);
  await expect(page.getByRole("heading",{name:"Reconcile completed refund"})).toBeVisible();
  await expect(page.getByText("Approved amount: $105.00")).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  for(const state of [staffState,customerState]){
   const ctx=await browser.newContext({storageState:state});
   const other=await ctx.newPage();
   await other.goto(url);
   await expect(other.getByRole("heading",{name:"Reconcile completed refund"})).toHaveCount(0);
   await ctx.close();
  }
  await page.getByRole("textbox",{name:"Evidence reference"}).fill("CHECK-"+agreement.id);
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"Record returned refund evidence"}).click();
  await expect(page).toHaveURL(new RegExp("/desk/agreements/"+agreement.id+"$"));
  const saved=await prisma.preDeliveryCancellation.findUniqueOrThrow({
   where:{agreementId:agreement.id}});
  expect(saved).toMatchObject({refundState:"RETURNED_MANUAL_RECORDED",
   refundMethod:"MANUAL_CHECK",refundDueCents:10500,returnedByUserId:owner.id});
 }finally{
  await prisma.preDeliveryCancellation.deleteMany({where:{agreementId:agreement.id}});
  await prisma.agreementSigningPayment.deleteMany({where:{agreementId:agreement.id}});
  await prisma.auditLog.deleteMany({where:{entityId:agreement.id}});
  await prisma.receipt.deleteMany({where:{id:receipt.id}});
  await prisma.rentalAgreement.delete({where:{id:agreement.id}});
  await prisma.serviceAddress.delete({where:{id:address.id}});
 }
});
