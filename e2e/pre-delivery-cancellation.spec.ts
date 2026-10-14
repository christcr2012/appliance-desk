import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const ownerState="e2e/.auth/owner.json";
const staffState="e2e/.auth/staff.json";
const customerState="e2e/.auth/customer.json";
const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&db.pathname==="/appliance_desk_test";
test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
test("owner reviews unpaid before-delivery cancellation; staff and customer cannot approve",async({page,browser})=>{
 test.skip(!enabled,"Requires disposable PostgreSQL and authenticated sessions.");
 for(const f of [ownerState,staffState,customerState])expect(fs.existsSync(f),f).toBe(true);
 const {prisma}=await import("../src/lib/prisma");
 const user=await prisma.user.findUniqueOrThrow({where:{email:process.env.TEST_CUSTOMER_EMAIL!.toLowerCase()}});
 const customer=await prisma.customer.findUniqueOrThrow({where:{userId:user.id}});
 const address=await prisma.serviceAddress.create({data:{customerId:customer.id,line1:"22 Cancel Review Way",city:"Greeley",state:"CO",zip:"80631"}});
 const agreement=await prisma.rentalAgreement.create({data:{customerId:customer.id,serviceAddressId:address.id,status:"DRAFT"}});
 const url="/desk/agreements/"+agreement.id+"/cancel";
 try{
  await page.goto(url);
  await expect(page.getByRole("heading",{name:"Cancellation and refund review"})).toBeVisible();
  await expect(page.getByText("There is no settled signing receipt.")).toBeVisible();
  await expect(page.getByText("Received: $0.00")).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  for(const state of [staffState,customerState]){
   const context=await browser.newContext({storageState:state});
   const p=await context.newPage();
   await p.goto(url);
   await expect(p.getByRole("heading",{name:"Cancellation and refund review"})).toHaveCount(0);
   await context.close();
  }
  await page.getByRole("textbox",{name:"Cancellation reason and exceptions"}).fill("Customer withdrew the order before delivery and before payment.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"Approve cancellation and record refund due"}).click();
  await expect(page).toHaveURL(new RegExp("/desk/agreements/"+agreement.id+"$"));
  const recorded=await prisma.preDeliveryCancellation.findUniqueOrThrow({where:{agreementId:agreement.id}});
  expect(recorded).toMatchObject({refundDueCents:0,refundState:"NOT_REQUIRED",reviewedTerms:true});
 }finally{
  await prisma.preDeliveryCancellation.deleteMany({where:{agreementId:agreement.id}});
  await prisma.auditLog.deleteMany({where:{entityId:agreement.id}});
  await prisma.rentalAgreement.delete({where:{id:agreement.id}});
  await prisma.serviceAddress.delete({where:{id:address.id}});
 }
});
