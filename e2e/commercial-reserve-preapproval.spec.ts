import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test,expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const state="e2e/.auth/owner.json";
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&url.pathname==="/appliance_desk_test"&&
  ["localhost","127.0.0.1"].includes(url.hostname);
test.use({storageState:fs.existsSync(state)?state:undefined});

test("OWNER allocates an exact commercial reserve once across two prepared rental properties",async({page})=>{
  test.skip(!enabled||!fs.existsSync(state),"Authenticated disposable PostgreSQL fixture only");
  const {prisma}=await import("../src/lib/prisma");
  const key=randomUUID().replaceAll("-","");
  const owner=await prisma.user.findFirstOrThrow({where:{role:"OWNER"}});
  const user=await prisma.user.create({data:{email:`reserve-browser-${key}@example.test`,
    role:"CUSTOMER",passwordHash:"test-only"}});
  const customer=await prisma.customer.create({data:{userId:user.id,isBusiness:true,
    referralCode:("BRA"+key).slice(0,20).toUpperCase()}});
  const addresses=await Promise.all([
    prisma.serviceAddress.create({data:{customerId:customer.id,
      line1:"101 Browser Test Drive",city:"Greeley",state:"CO",zip:"80631"}}),
    prisma.serviceAddress.create({data:{customerId:customer.id,
      line1:"202 Browser Test Drive",city:"Greeley",state:"CO",zip:"80631"}}),
  ]);
  const kind=await prisma.applianceType.create({data:{
    name:"Browser reserve "+key,slug:"browser-reserve-"+key,monthlyPriceCents:3500}});
  const pkg=await prisma.rentalPackage.create({data:{
    name:"Browser reserve set "+key,slug:"browser-rset-"+key,monthlyPriceCents:6000,
    components:{create:[{applianceTypeId:kind.id,quantity:2}]},
  }});
  const estimate=await prisma.estimate.create({data:{
    title:"Business reserve review "+key,customerId:customer.id,
    createdByUserId:owner.id,status:"DRAFT",depositCents:15000,
    lineItems:{create:addresses.map((a,index)=>({
      serviceAddressId:a.id,description:"Appliance set "+index,
      packageId:pkg.id,quantity:1,monthlyPriceCents:6000,
    }))},
  }});
  try{
    await page.setViewportSize({width:390,height:844});
    await page.goto("/desk/estimates/"+estimate.id);
    const prep=page.getByRole("region",{name:"Prepare estimate agreements"});
    await prep.getByRole("button",{name:"Prepare owned draft agreements"}).click();
    await expect(prep.getByText(/Prepared 2 draft agreement/)).toBeVisible();
    await page.reload();
    const section=page.locator('section[aria-labelledby="commercial-reserve-title"]');
    await expect(section).toBeVisible();
    await expect(section.getByText(/Estimate requested reserve/)).toBeVisible();
    const amounts=section.locator('input[name^="amount_"]');
    await expect(amounts).toHaveCount(2);
    await amounts.nth(0).fill("100.00");
    await amounts.nth(1).fill("50.00");
    const options=section.locator('select[name^="replenishment_"]');
    await options.nth(0).selectOption("QUARTERLY");
    await options.nth(1).selectOption("QUARTERLY");
    const terms=section.locator('textarea[name^="terms_"]');
    await terms.nth(0).fill("Business property owner approved refundable reserve for first address");
    await terms.nth(1).fill("Business property owner approved refundable reserve for second address");
    await section.locator('textarea[name="reason"]').fill(
      "Owner negotiated per-property allocation for commercial reserve before quoting");
    await section.getByRole("button",{name:"Record all location reserve decisions"}).click();
    await expect(section.getByRole("status")).toContainText(/draft reserve policy recorded/i);
    const rows=await prisma.rentalAgreement.findMany({
      where:{sourceEstimateId:estimate.id},
      select:{id:true,status:true,depositCents:true,commercialReservePolicyVersions:true}});
    expect(rows).toHaveLength(2);
    expect(rows.map(row=>row.depositCents).sort((a,b)=>a-b)).toEqual([5000,10000]);
    expect(rows.every(row=>row.status==="DRAFT" &&
      Array.isArray(row.commercialReservePolicyVersions) &&
      row.commercialReservePolicyVersions.length===1)).toBe(true);
    expect(await prisma.deposit.count({where:{agreementId:{in:rows.map(row=>row.id)}}})).toBe(0);
    expect((await prisma.estimate.findUniqueOrThrow({where:{id:estimate.id}})).depositPaidAt).toBeNull();
    await page.reload();
    const check=await new AxeBuilder({page}).withTags([
      "wcag2a","wcag2aa","wcag21a","wcag21aa",
    ]).analyze();
    expect(check.violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{
    await prisma.rentalAgreement.deleteMany({where:{sourceEstimateId:estimate.id}});
    await prisma.estimate.delete({where:{id:estimate.id}});
    await prisma.auditLog.deleteMany({where:{entityId:estimate.id}});
    await prisma.rentalPackageComponent.deleteMany({where:{packageId:pkg.id}});
    await prisma.rentalPackage.delete({where:{id:pkg.id}});
    await prisma.applianceType.delete({where:{id:kind.id}});
    await prisma.serviceAddress.deleteMany({where:{id:{in:addresses.map(a=>a.id)}}});
    await prisma.customer.delete({where:{id:customer.id}});
    await prisma.user.delete({where:{id:user.id}});
  }
});
