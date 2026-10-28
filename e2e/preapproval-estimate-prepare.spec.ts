import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const state = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);
test.use({ storageState: fs.existsSync(state) ? state : undefined });

test("owner can prepare actual estimate-owned agreement shells without approving or booking", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(state), "Disposable authenticated CI fixtures only");
  const { prisma } = await import("../src/lib/prisma");
  const marker = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
  const address = await prisma.serviceAddress.findFirstOrThrow();
  const pkg = await prisma.rentalPackage.findFirstOrThrow();
  const estimate = await prisma.estimate.create({ data: {
    title: "Preapproval owner preparation " + marker, customerId: address.customerId,
    createdByUserId: owner.id, status: "DRAFT",
    lineItems: { create: [{
      description: "Prepared package fixture", packageId: pkg.id,
      serviceAddressId: address.id, quantity: 1, monthlyPriceCents: pkg.monthlyPriceCents,
      oneTimeFeeCents: 0,
    }] },
  } });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/desk/estimates/" + estimate.id);
    const section = page.getByRole("region", { name: "Prepare estimate agreements" });
    await expect(section).toBeVisible();
    await expect(section.getByText(/not sent, approved, converted or charged/i)).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Prepare owned draft agreements" })).toBeEnabled();
    await section.getByRole("button", { name: "Prepare owned draft agreements" }).click();
    await expect(section.getByText(/Prepared 1 draft agreement/i)).toBeVisible();
    const latest = await prisma.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
    expect(latest.status).toBe("DRAFT");
    expect(latest.reviewedQuoteFingerprint).toBeNull();
    expect(latest.depositPaidAt).toBeNull();
    const children = await prisma.rentalAgreement.findMany({
      where: { sourceEstimateId: estimate.id },
    });
    expect(children).toHaveLength(1);
    expect(children[0].customerId).toBe(address.customerId);
    expect(children[0].status).toBe("DRAFT");
    await prisma.estimate.update({ where: { id: estimate.id },
      data: { status: "SENT", sentAt: new Date() } });
    await page.goto("/estimate/" + estimate.id);
    await expect(page.getByRole("button", { name: "Approve estimate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();
    await expect(page.getByText(/reviewed all-in offer needs to be refreshed/i)).toBeVisible();
    const { approveEstimate } = await import("../src/domains/estimates");
    await expect(approveEstimate(estimate.id, {
      expectedQuoteFingerprint: "a".repeat(64),
      approverName: "Unauthorised incomplete estimate",
      approverEmail: "not-approved@example.test", ipAddress: "127.0.0.1",
    })).rejects.toThrow(/reviewed|all-in/i);
    // Opening the link legitimately records VIEWED; approval must not advance it.
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: estimate.id } })).status).toBe("VIEWED");
    await page.goto("/desk/estimates/" + estimate.id);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await prisma.rentalAgreement.deleteMany({ where: { sourceEstimateId: estimate.id } });
    await prisma.estimate.delete({ where: { id: estimate.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: estimate.id } });
  }
});

test("W-24 owner chooses future local delivery windows on mobile; guest cannot access desk or create visit",async({page,browser})=>{
  test.skip(!enabled||!fs.existsSync(state),"Disposable authenticated CI fixture only");
  const {prisma}=await import("../src/lib/prisma");
  const idPart=randomUUID().replaceAll("-","");
  const owner=await prisma.user.findFirstOrThrow({where:{role:"OWNER"}});
  const address=await prisma.serviceAddress.findFirstOrThrow();
  const pkg=await prisma.rentalPackage.findFirstOrThrow();
  const quote=await prisma.estimate.create({data:{
    title:"W-24 owner offered delivery "+idPart,
    customerId:address.customerId,createdByUserId:owner.id,status:"DRAFT",
    lineItems:{create:[{description:"Approved package fixture",packageId:pkg.id,
      serviceAddressId:address.id,quantity:1,monthlyPriceCents:pkg.monthlyPriceCents,
      oneTimeFeeCents:0}]},
  }});
  try{
    await page.setViewportSize({width:390,height:844});
    await page.goto("/desk/estimates/"+quote.id);
    const header=page.getByRole("heading",{name:"Owner-offered delivery windows"});
    await expect(header).toBeVisible();
    const after=new Date(Date.now()+15*24*60*60*1000).toISOString().slice(0,10);
    const offerPanel=header.locator('..');
    const dateInput = offerPanel.locator('input[type="date"]').first();
    const save = offerPanel.getByRole("button",{name:"Save offered windows"});
    // Server-rendered fields may be visible before React has attached their onChange handler.
    // Prove the controlled date has reached React state and that saving is actually enabled.
    await expect(async () => {
      await dateInput.fill("");
      await dateInput.fill(after);
      await expect(save).toBeEnabled({timeout:1000});
    }).toPass({timeout:15000});
    await save.click();
    await expect(offerPanel.getByText(/Saved; old customer choice versions are invalidated/i)).toBeVisible();
    const found=await prisma.estimate.findUniqueOrThrow({
      where:{id:quote.id},select:{deliveryOfferVersion:true,deliveryOffer:true}});
    expect(found.deliveryOfferVersion).toBe(1);
    expect(Array.isArray(found.deliveryOffer)).toBe(true);
    expect(await prisma.job.count({where:{customerId:quote.customerId,
      notes:{contains:idPart}}})).toBe(0);
    const guest=await browser.newContext({storageState:{cookies:[],origins:[]}});
    try{
      const anon=await guest.newPage();
      await anon.goto("/desk/estimates/"+quote.id);
      await expect(anon).toHaveURL(/login|sign-in/i);
      await expect(anon.getByText("Owner-offered delivery windows")).toHaveCount(0);
    }finally{await guest.close();}
  }finally{
    await prisma.auditLog.deleteMany({where:{entityId:quote.id}});
    await prisma.estimate.delete({where:{id:quote.id}});
  }
});
