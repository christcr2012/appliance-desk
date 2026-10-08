import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertTaxReadyForAgreement } from "@/domains/tax/locations";
const u = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && u.pathname === "/appliance_desk_test" && ["localhost","127.0.0.1"].includes(u.hostname);
class Rollback extends Error {}
describe.skipIf(!enabled)("T-6C4 conditional Colorado delivery fee readiness", () => {
 it("only blocks applicable undecided fee and unblocks after CPA and owner decisions", async () => {
  try { await prisma.$transaction(async (tx:Prisma.TransactionClient) => {
   const key=randomUUID().replaceAll("-","");
   const user=await tx.user.create({data:{email:key+"@rdf4.example.test",name:"RDF fixture",role:"OWNER",passwordHash:"test"}});
   const customer=await tx.customer.create({data:{userId:user.id,referralCode:"RR"+key.slice(0,16)}});
   const jurisdiction=await tx.taxJurisdiction.create({data:{
      code:"RDF4-"+key,name:"Colorado sample",level:"STATE",administration:"STATE_COLLECTED",reviewStatus:"REVIEWED",
      rates:{create:{effectiveFrom:new Date("2020-01-01"),rateMilliPercent:1000,source:"MANUAL"}},
      rules:{create:{category:"RENTAL",taxability:"TAXABLE",reason:"synthetic test"}}
   }});
   await tx.businessSettings.update({where:{id:"singleton"},data:{
      shortTermLeaseElection:"COLLECT_ON_RENTALS",rdfThresholdCents:1,rdfHandling:"UNDECIDED",rdfCpaConfirmedOn:null
   }});
   async function agreement(state:string) {
     const address=await tx.serviceAddress.create({data:{customerId:customer.id,line1:"1 Test Road",city:"Greeley",state,zip:"80631"}});
     await tx.addressTaxLocation.create({data:{serviceAddressId:address.id,isCurrent:true,lookedUpAt:new Date("2026-08-01"),status:"VERIFIED",source:"MANUAL",jurisdictions:{create:{jurisdictionId:jurisdiction.id}}}});
     return tx.rentalAgreement.create({data:{customerId:customer.id,serviceAddressId:address.id,status:"ACTIVE",lines:{create:{label:"Washer",monthlyPriceCents:3500,listPriceCents:3500}}}});
   }
   const colorado=await agreement("CO"), other=await agreement("WY");
   await tx.invoice.create({data:{customerId:customer.id,agreementId:colorado.id,status:"OPEN",issuedAt:new Date("2025-08-01"),amountDueCents:3500,lineItems:{create:{kind:"RENTAL",description:"Past rental",amountCents:3500}}}});
   await expect(assertTaxReadyForAgreement(tx,colorado.id,new Date("2026-08-01"))).rejects.toThrow(/delivery fee/i);
   await expect(assertTaxReadyForAgreement(tx,other.id,new Date("2026-08-01"))).resolves.toBeUndefined();
   await tx.businessSettings.update({where:{id:"singleton"},data:{rdfHandling:"PAY_MYSELF",rdfCpaConfirmedOn:new Date("2026-07-01")}});
   await expect(assertTaxReadyForAgreement(tx,colorado.id,new Date("2026-08-01"))).resolves.toBeUndefined();
   throw new Rollback();
  },{timeout:30000}); } catch(e) { if (!(e instanceof Rollback)) throw e; }
 });
});
