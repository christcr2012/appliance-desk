import fs from "node:fs";
import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createSyntheticW22V2Order } from "../tests/helpers/w22-v2-order";
const ownerState="e2e/.auth/owner.json";
const customerState="e2e/.auth/customer.json";
const target=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&target.pathname==="/appliance_desk_test"&&["localhost","127.0.0.1"].includes(target.hostname);
test.use({storageState:fs.existsSync(ownerState)?ownerState:undefined});
test("V2 complete order clearance, customer signature, owner receipt and own-account readback",async({page,browser},info)=>{
 test.setTimeout(60_000);
 test.skip(!enabled,"Disposable isolated database only");
 const {prisma}=await import("../src/lib/prisma");
 const user=await prisma.user.findUniqueOrThrow({where:{email:process.env.TEST_CUSTOMER_EMAIL!.toLowerCase()}});
 const customer=await prisma.customer.findUniqueOrThrow({where:{userId:user.id}});
 const fixture=await createSyntheticW22V2Order({customerId:customer.id});
 const context=await browser.newContext({storageState:customerState,baseURL:info.project.use.baseURL as string});
 try{
  const path="/desk/agreements/"+fixture.ids[0];
  await page.setViewportSize({width:390,height:960});
  await page.goto(path);
  await expect(page.getByRole("heading",{name:"Signing business clearance"})).toBeVisible();
  await expect(page.getByText("$456.06",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Send for signature",exact:true}).click();
  await expect(page.getByText(/requires current owner-recorded CPA and counsel advice/)).toBeVisible();
  const clearance=page.getByRole("region",{name:"Signing business clearance"});
  await clearance.getByRole("combobox",{name:"Decision",exact:true}).selectOption("APPROVED");
  await clearance.getByLabel("Advice received on").fill(fixture.day);
  await clearance.getByLabel("CPA advice reference").fill("Synthetic CPA fixture advice only");
  await clearance.getByLabel("Attorney advice reference").fill("Synthetic attorney fixture advice only");
  await clearance.getByLabel("Exact reviewed terms reference").fill("Synthetic complete signing and refund terms");
  await clearance.getByLabel("Reason for this decision").fill("Synthetic browser test of the owner attestation workflow");
  await clearance.getByRole("checkbox").check();
  for(const width of [360,768,1440]){
   await page.setViewportSize({width,height:960});
   for(const dark of [false,true]){
    await page.evaluate(value=>document.documentElement.classList.toggle("dark",value),dark);
    expect((await new AxeBuilder({page}).include('[aria-label="Signing business clearance"]').withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
   }
  }
  await clearance.getByRole("combobox",{name:"Decision",exact:true}).focus();
  await page.keyboard.press("Tab");
  await expect(clearance.getByLabel("Effective Colorado business day")).toBeFocused();
  await clearance.getByRole("button",{name:"Record review revision"}).click();
  await expect(clearance.getByText(/Recorded professional advice clearance/)).toBeVisible();
  await page.getByRole("button",{name:"Send for signature",exact:true}).click();
  await expect.poll(async()=>prisma.signatureRecord.count({where:{agreementId:fixture.ids[0]}})).toBe(1);
  const signature=await prisma.signatureRecord.findUniqueOrThrow({where:{agreementId:fixture.ids[0]}});
  const customerPage=await context.newPage();
  await customerPage.goto("/sign/"+signature.id);
  await expect(customerPage.getByText("$456.06",{exact:true})).toBeVisible();
  await expect(customerPage.getByText(/Tax-inclusive signing amount: \$286.31/)).toBeVisible();
  await customerPage.getByLabel("Your full legal name").fill("Synthetic Browser Customer");
  await customerPage.getByLabel("Your email").fill(user.email);
  await customerPage.getByRole("checkbox",{name:/I have read the terms/}).check();
  await customerPage.getByRole("button",{name:"Sign agreement",exact:true}).click();
  await expect.poll(async()=>prisma.agreementSigningPayment.count({where:{agreementId:fixture.ids[0],status:"AWAITING_PAYMENT",totalCents:28631}})).toBe(1);
  expect(await prisma.agreementSigningPayment.count({where:{agreementId:fixture.ids[1]}})).toBe(0);
  await page.goto(path);
  await page.getByLabel("Payment reference").fill("SYN-BROWSER-"+fixture.tag);
  await page.getByRole("checkbox",{name:/I verified that the full/}).check();
  await page.getByRole("button",{name:"Record signing payment",exact:true}).click();
  await expect.poll(async()=>(await prisma.agreementSigningPayment.findUniqueOrThrow({where:{agreementId:fixture.ids[0]}})).status).toBe("SETTLED");
  await customerPage.goto("/account/rentals");
  await expect(customerPage.getByText("$286.31",{exact:true})).toBeVisible();
  await expect(customerPage.getByText("Refundable commercial reserve",{exact:true})).toBeVisible();
  await expect(customerPage.getByText(/Signing payment recorded as received/)).toBeVisible();
  expect(await prisma.deposit.count({where:{agreementId:fixture.ids[0],amountCents:10000}})).toBe(1);
 }finally{await context.close();await fixture.cleanup();}
});
