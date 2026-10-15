import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySigningV2Extension, SIGNING_V2_CATEGORIES, type SigningV2Extension } from "@/domains/billing/signing-v2-lines";
const fixture = (): SigningV2Extension => ({
  components: SIGNING_V2_CATEGORIES.map(category=>({
    id:`synthetic:${category}`,category,amountCents:
      category==="ADMINISTRATIVE_SETUP"?4500:category==="FIRST_MONTH_RENT_ADVANCE"?6000:
      category==="DELIVERY"?7500:category==="COMMERCIAL_RESERVE"?10000:
      category==="RETAIL_DELIVERY_FEE"?31:0,
    disposition:["INSTALLATION","REMOVAL","DAMAGE_WAIVER"].includes(category)?"NOT_APPLICABLE":"DUE_NOW",
    sourceFingerprint:"a".repeat(64),sourceRevision:1,reason:null,
    termsReference:category==="COMMERCIAL_RESERVE"?"Synthetic reviewed reserve terms":null,
  })),
  taxLines:[
    {componentId:"synthetic:ADMINISTRATIVE_SETUP",jurisdictionId:"synthetic-j",rateVersionId:"synthetic-r",category:"ADMINISTRATIVE_SETUP",taxableCents:4500,exemptCents:0,taxCents:225},
    {componentId:"synthetic:DELIVERY",jurisdictionId:"synthetic-j",rateVersionId:"synthetic-r",category:"DELIVERY",taxableCents:7500,exemptCents:0,taxCents:375},
  ],ownerPolicyRevision:1,mandatoryReviewRevision:1,mandatoryReviewFingerprint:"b".repeat(64),
  reserveTermsRevision:1,reserveTermsReference:"Synthetic reviewed reserve terms",
});
async function check(value:unknown){
  const rows=await prisma.$queryRaw<Array<{valid:boolean}>>`SELECT "w22_v2_due"(${JSON.stringify(value)}::jsonb, 'synthetic'::text, 4500::bigint, 225::bigint, 6000::bigint, 28631::bigint) AS valid`;
  return rows[0].valid;
}
describe("V2 SQL money evidence matches the domain and denies null CHECK bypass",()=>{
  it("accepts the complete reviewed nonzero fixture",async()=>{
    expect(await check(fixture())).toBe(true);
    expect(verifySigningV2Extension(fixture(),{agreementId:"synthetic",setupFeeCents:4500,setupTaxCents:225,downPaymentCents:6000,allInCents:28631})).toBeTruthy();
  });
  it("never returns SQL NULL for incomplete JSON",async()=>{
    for(const raw of [null,{},[],{components:[]},{taxLines:[]}, {components:Array(8).fill(null),taxLines:[]}])
      expect(await check(raw)).toBe(false);
  });
  it("rejects missing ids, money, sources, terms and mismatched tax categories",async()=>{
    const cases:Array<(f:SigningV2Extension)=>void>=[
      f=>{delete (f.components[0] as Partial<typeof f.components[0]>).id;},
      f=>{delete (f.components[0] as Partial<typeof f.components[0]>).amountCents;},
      f=>{f.components[0].sourceFingerprint="";},
      f=>{f.components[0].sourceRevision=1.5;},
      f=>{f.reserveTermsReference=null;},
      f=>{f.reserveTermsRevision=null;},
      f=>{f.taxLines[1].category="RENTAL";},
      f=>{f.taxLines[1].taxableCents=7499.5;f.taxLines[1].exemptCents=.5;},
      f=>{f.taxLines[1].taxableCents=7501;f.taxLines[1].exemptCents=-1;},
      f=>{f.components[1]={...f.components[0]};},
      f=>{f.taxLines.push({...f.taxLines[0]});},
    ];
    for(const mutate of cases){const f=fixture();mutate(f);expect(await check(f)).toBe(false);}
  });
  it("guards the obligation table with an enforced version-aware constraint",async()=>{
    const result=await prisma.$queryRaw<Array<{definition:string;validated:boolean}>>(Prisma.sql`
      SELECT pg_get_constraintdef(oid) AS definition, convalidated AS validated
      FROM pg_constraint WHERE conname='AgreementSigningPayment_frozen_amounts_check'`);
    expect(result).toHaveLength(1);expect(result[0].validated).toBe(true);
    expect(result[0].definition).toContain('w22_v2_due');
  });
});
