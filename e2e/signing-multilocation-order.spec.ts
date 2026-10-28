import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const allowed = process.env.CI === "true" &&
  ["localhost","127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const owner = "e2e/.auth/owner.json";
test.use({storageState:fs.existsSync(owner) ? owner : undefined});

test("signing link shows complete verified two-address order without collecting or signing sibling agreement",async({page})=>{
  test.skip(!allowed || !fs.existsSync(owner),"Disposable database only");
  const {prisma} = await import("../src/lib/prisma");
  const id = randomUUID().replaceAll("-","");
  const ids=["w22-sign-"+id+"-a","w22-sign-"+id+"-b"];
  const addresses:string[]=[];
  const estimateId="w22-sign-estimate-"+id;
  const sigId="w22-sign-link-"+id;
  try {
    const original=await prisma.serviceAddress.findFirstOrThrow();
    const ownerId=(await prisma.user.findFirstOrThrow({where:{role:"OWNER"}})).id;
    const second=await prisma.serviceAddress.create({data:{
      customerId:original.customerId,line1:"214 Frozen Second Street",
      city:"Evans",state:"CO",zip:"80620",
    }});
    addresses.push(second.id);
    await prisma.estimate.create({data:{
      id:estimateId,title:"Two site frozen offer",customerId:original.customerId,createdByUserId:ownerId,status:"CONVERTED",
    }});
    await page.goto("/estimate/"+estimateId);
    await expect(page.getByRole("heading",{name:"Your complete order price is being reviewed"})).toBeVisible();
    await expect(page.getByText("Combined signing amount across addresses")).toHaveCount(0);
    const fields=[
      {id:ids[0],addressId:original.id,setupFeeCents:4500,downPaymentCents:4000},
      {id:ids[1],addressId:second.id,setupFeeCents:0,downPaymentCents:6000},
    ];
    const sourceFingerprint="f".repeat(64);
    const lines=fields.map(f=>({
      agreementId:f.id,serviceAddressId:f.addressId,version:1,
      setupFeeCents:f.setupFeeCents,downPaymentCents:f.downPaymentCents,
      setupTaxCents:0,allInCandidateCents:f.setupFeeCents+f.downPaymentCents,
      jurisdictionEvidence:[],
    })).sort((a,b)=>a.agreementId.localeCompare(b.agreementId));
    const digest=createHash("sha256").update(JSON.stringify({sourceFingerprint,lines})).digest("hex");
    for(const [i,row] of fields.entries()){
      await prisma.rentalAgreement.create({data:{
        id:row.id,sourceEstimateId:estimateId,customerId:original.customerId,
        serviceAddressId:row.addressId,status:"AWAITING_SIGNATURE",
        lines:{create:{label:"Frozen washer "+i,monthlyPriceCents:4000+i*2000,
          listPriceCents:4000+i*2000}},
        ...(i===0?{signature:{create:{
          id:sigId,provider:"typed_signature",signingOrderFingerprint:digest,
          signingAllInCents:row.setupFeeCents+row.downPaymentCents,
          signingEvidenceVersion:1,
        }}}:{}),
      }});
      await prisma.agreementSigningCharge.create({data:{
        agreementId:row.id,serviceAddressId:row.addressId,version:1,machineCount:1,
        firstMonthRentCents:4000+i*2000,setupFeeCents:row.setupFeeCents,
        downPaymentCents:row.downPaymentCents,
        signingSubtotalCents:row.setupFeeCents+row.downPaymentCents,
        setupFeeTaxTreatment:"UNDECIDED",settingsUpdatedAt:new Date(),
        sourceFingerprint,createdByUserId:ownerId,frozenAt:new Date(),
        frozenOrderFingerprint:digest,
        frozenAllInCents:row.setupFeeCents+row.downPaymentCents,
        frozenSetupTaxCents:0,
        frozenChargeEvidence:{
          schemaVersion:1,agreementId:row.id,serviceAddressId:row.addressId,
          agreementVersion:1,sourceFingerprint,orderFingerprint:digest,
          setupFeeCents:row.setupFeeCents,downPaymentCents:row.downPaymentCents,
          setupTaxCents:0,allInCents:row.setupFeeCents+row.downPaymentCents,
          jurisdictions:[],
        },
      }});
    }
    for(const width of [360,768,1440]){
      await page.setViewportSize({width,height:920});
      await page.goto("/sign/"+sigId);
      await expect(page.getByRole("heading",{name:"Complete reviewed signing order"})).toBeVisible();
      await expect(page.getByText(/214 Frozen Second Street/)).toBeVisible();
      await expect(page.getByText("Combined signing amount across addresses")).toBeVisible();
      await expect(page.getByText("$145",{exact:true})).toBeVisible();
      await expect(page.getByText("Tax-inclusive signing amount: $85")).toBeVisible();
      await expect(page.getByRole("button",{name:"Sign agreement"})).toBeVisible();
      const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
      expect(axe.violations).toEqual([]);
    }
    await page.goto("/estimate/"+estimateId);
    await expect(page.getByRole("heading",{name:"Complete reviewed signing order"})).toBeVisible();
    await expect(page.getByText("Combined signing amount across addresses")).toBeVisible();
    await expect(page.getByText("$145",{exact:true})).toBeVisible();
    await expect(page.getByText(/not a signature or payment request/)).toBeVisible();
    await page.goto("/desk/estimates/"+estimateId);
    await expect(page.getByRole("link",{name:"View customer estimate and final reviewed order"})).toBeVisible();
    expect((await prisma.signatureRecord.findUniqueOrThrow({where:{id:sigId}})).signedAt).toBeNull();
    expect(await prisma.agreementSigningPayment.count({where:{agreementId:{in:ids}}})).toBe(0);
    await page.goto("/desk/agreements/"+ids[0]+"?tab=signing");
    await expect(page.getByRole("heading",{name:"Complete reviewed signing order"})).toBeVisible();
    await expect(page.getByText("Combined signing amount across addresses")).toBeVisible();
  } finally {
    await prisma.signatureRecord.deleteMany({where:{agreementId:{in:ids}}});
    await prisma.agreementSigningCharge.deleteMany({where:{agreementId:{in:ids}}});
    await prisma.rentalLine.deleteMany({where:{agreementId:{in:ids}}});
    await prisma.rentalAgreement.deleteMany({where:{id:{in:ids}}});
    await prisma.estimate.deleteMany({where:{id:estimateId}});
    await prisma.serviceAddress.deleteMany({where:{id:{in:addresses}}});
  }
});
