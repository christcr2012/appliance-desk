import fs from "node:fs";
import {test,expect} from "@playwright/test";
const owner="e2e/.auth/owner.json",staff="e2e/.auth/staff.json",customerState="e2e/.auth/customer.json";
const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&db.pathname==="/appliance_desk_test";
test.use({storageState:fs.existsSync(owner)?owner:undefined});
test("owner can schedule a signed delivery draft; staff finance To do stays private",async({page,browser})=>{
 test.skip(!enabled,"Disposable Postgres and saved owner session required.");
 expect(fs.existsSync(owner)).toBe(true);
 const {prisma}=await import("../src/lib/prisma");
 const user=await prisma.user.findUniqueOrThrow({where:{email:process.env.TEST_CUSTOMER_EMAIL!.toLowerCase()}});
 const customer=await prisma.customer.findUniqueOrThrow({where:{userId:user.id}});
 const address=await prisma.serviceAddress.create({data:{
  customerId:customer.id,line1:"72 Delivery To do Ave",city:"Greeley",state:"CO",zip:"80631"}});
 const agreement=await prisma.rentalAgreement.create({data:{
  customerId:customer.id,serviceAddressId:address.id,status:"ACTIVE",startDate:new Date()}});
 const signature=await prisma.signatureRecord.create({data:{
  agreementId:agreement.id,provider:"test",signedAt:new Date(),signerName:"Customer",
 }});
 const job=await prisma.job.create({data:{
  type:"DELIVERY",status:"SCHEDULED",scheduledAt:null,
  customerId:customer.id,serviceAddressId:address.id,agreementId:agreement.id,
 }});
 try{
  if (fs.existsSync(customerState)) {
   const customerContext=await browser.newContext({storageState:customerState});
   try {
    const customerPage=await customerContext.newPage();
    await customerPage.goto("/account/rentals");
    await expect(customerPage.getByText("72 Delivery To do Ave", {exact:false})).toBeVisible();
    await expect(customerPage.getByText("Delivery is being arranged.", {exact:false})).toBeVisible();
    await expect(customerPage.getByText("This is a request in progress, not a booked appointment.", {exact:false})).toBeVisible();
    await prisma.job.update({where:{id:job.id},data:{scheduledAt:new Date("2026-10-20T16:00:00Z")}});
    await customerPage.reload();
    await expect(customerPage.getByText("Delivery is being arranged.", {exact:false})).toHaveCount(0);
    await expect(customerPage.getByText("Tuesday, October 20, 2026", {exact:false})).toBeVisible();
    await prisma.job.update({where:{id:job.id},data:{scheduledAt:null}});
   } finally { await customerContext.close(); }
  }
  await page.goto("/desk/today");
  const jobLink=page.locator("a[href='/desk/jobs/"+job.id+"']").first();
  await expect(jobLink).toBeVisible();
  await expect(page.getByText("Schedule delivery for",{exact:false}).first()).toBeVisible();
  await jobLink.click();
  await expect(page).toHaveURL(new RegExp("/desk/jobs/"+job.id));
  if(fs.existsSync(staff)){
   const context=await browser.newContext({storageState:staff});
   const staffPage=await context.newPage();
   await staffPage.goto("/desk/today");
   await expect(staffPage.getByText("Schedule delivery for",{exact:false})).toHaveCount(0);
   await context.close();
  }
 }finally{
  await prisma.job.deleteMany({where:{id:job.id}});
  await prisma.signatureRecord.deleteMany({where:{id:signature.id}});
  await prisma.rentalAgreement.delete({where:{id:agreement.id}});
  await prisma.serviceAddress.delete({where:{id:address.id}});
 }
});
