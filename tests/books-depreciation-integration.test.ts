import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
 enrollBookAsset,postBookDepreciation,setBookAssetPolicy,retireBookAsset,
 addBookTaxEvidence,setBookDepreciationDefaults,getBookAssets,
} from "@/domains/books/fixed-assets";

const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,12),owner="k6-owner-"+tag,admin="k6-admin-"+tag,staff="k6-staff-"+tag;
const type="k6-type-"+tag,id="k6-appliance-"+tag;
const bought=new Date("2026-01-15T07:00:00.000Z");
let savedStart:Date|null=null,savedLife=60,savedSalvage=0;
describe.skipIf(!enabled)("K-6 source-accounted rental fixed assets in disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  savedStart=settings.booksStartDate;
  savedLife=settings.depreciationMonthsDefault;
  savedSalvage=settings.depreciationSalvagePercent;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:new Date("2026-01-01T07:00:00Z"),
   depreciationMonthsDefault:6,depreciationSalvagePercent:0,
  }});
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:admin,email:admin+"@example.test",role:"ADMIN"},
   {id:staff,email:staff+"@example.test",role:"STAFF"},
  ]});
  await prisma.applianceType.create({data:{id:type,name:"K6 test washer "+tag,slug:"k6-"+tag}});
  await prisma.appliance.create({data:{id,assetNumber:"K6-"+tag,applianceTypeId:type,
   acquisitionCostCents:12000,purchaseDate:bought,status:"AVAILABLE"}});
 });
 afterAll(async()=>{
  await prisma.bookTaxEvidence.deleteMany({where:{applianceId:id}});
  await prisma.bookAsset.deleteMany({where:{applianceId:id}});
  const entries=await prisma.journalEntry.findMany({where:{sourceType:"APPLIANCE",sourceId:id},select:{id:true}});
  await prisma.journalLine.deleteMany({where:{entryId:{in:entries.map(x=>x.id)}}});
  await prisma.journalEntry.deleteMany({where:{sourceType:"APPLIANCE",sourceId:id}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,admin,staff]}}});
  await prisma.appliance.delete({where:{id}});
  await prisma.applianceType.delete({where:{id:type}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:savedStart,depreciationMonthsDefault:savedLife,depreciationSalvagePercent:savedSalvage,
  }});
  await prisma.user.deleteMany({where:{id:{in:[owner,admin,staff]}}});
 });
 it("denies inactive/STAFF enrollment and refuses fabricated acquisition",async()=>{
  await expect(enrollBookAsset(staff,id,"2026-01-15")).rejects.toThrow(/access/);
  await expect(enrollBookAsset(owner,id,"2025-10-18")).rejects.toThrow(/opening|start date/);
  await expect(enrollBookAsset(owner,"missing-asset","2026-01-15")).rejects.toThrow(/cost/);
 });
 it("attests immutable source cost and blocks mismatched re-enrollment",async()=>{
  expect(await enrollBookAsset(owner,id,"2026-01-15")).toBe(id);
  expect(await enrollBookAsset(owner,id,"2026-01-15")).toBe(id);
  await expect(enrollBookAsset(owner,id,"2026-02-01")).rejects.toThrow(/differs/);
  const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}});
  expect(asset).toMatchObject({costCents:12000,lifeMonths:6,salvagePercent:0,version:1});
  expect((await getBookAssets(admin)).assets.map(x=>x.applianceId)).toContain(id);
  await expect(getBookAssets(staff)).rejects.toThrow(/access/);
 });
 it("creates one balanced K2 asset source and uniquely posted completed depreciation month",async()=>{
  const once=await postBookDepreciation(owner,id,"2026-02");
  expect(once).toMatchObject({posted:1,lastCompleted:"2026-02"});
  const again=await postBookDepreciation(owner,id,"2026-02");
  expect(again.posted).toBe(0);
  const rows=await prisma.journalEntry.findMany({where:{sourceType:"APPLIANCE",sourceId:id},include:{lines:true}});
  expect(rows.map(r=>r.eventKind).sort()).toEqual(["APPLIANCE_CONTRIBUTED","DEPRECIATION:2026-02"]);
  for(const row of rows)expect(row.lines.reduce((n,l)=>n+l.debitCents-l.creditCents,0)).toBe(0);
  expect((await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}})).lastDepreciationMonth).toBe("2026-02");
  await expect(postBookDepreciation(staff,id,"2026-03")).rejects.toThrow(/access/);
  await expect(postBookDepreciation(owner,id,"2026-11")).rejects.toThrow(/completed Colorado/);
 });
 it("serializes concurrent month replay without double posting",async()=>{
  const results=await Promise.allSettled([
   postBookDepreciation(owner,id,"2026-04"),
   postBookDepreciation(owner,id,"2026-04"),
  ]);
  expect(results.some(x=>x.status==="fulfilled")).toBe(true);
  expect(await prisma.journalEntry.count({where:{
   sourceType:"APPLIANCE",sourceId:id,eventKind:{startsWith:"DEPRECIATION:"},
  }})).toBe(3);
  const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}});
  expect(asset.lastDepreciationMonth).toBe("2026-04");
 });
 it("edits only unposted lifetime, preserving archived depreciation journals",async()=>{
  const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}});
  await expect(setBookAssetPolicy(admin,id,asset.version,8,0)).rejects.toThrow(/access/);
  await setBookAssetPolicy(owner,id,asset.version,8,0);
  await expect(setBookAssetPolicy(owner,id,asset.version,8,0)).rejects.toThrow(/changed/);
  expect(await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",sourceId:id,eventKind:{startsWith:"DEPRECIATION:"}})).toBe(3);
  await setBookDepreciationDefaults(owner,24,5);
  expect((await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}})).lifeMonths).toBe(8);
 });
 it("captures separate CPA evidence without inventing a tax return or recapture",async()=>{
  await expect(addBookTaxEvidence(staff,id,{classification:"RENTAL_ASSET",
   confidence:"UNKNOWN",originalBasisCents:null,signedAdjustmentsCents:null,
   allowedDepreciationCents:null,section179Cents:null,bonusDepreciationCents:null,
   evidenceDate:"2026-04-30",sourceReference:"awaiting CPA"})).rejects.toThrow(/access/);
  const evidence=await addBookTaxEvidence(owner,id,{
   classification:"RENTAL_ASSET",confidence:"CPA_CONFIRMED",originalBasisCents:12000,
   signedAdjustmentsCents:0,allowedDepreciationCents:4000,section179Cents:0,
   bonusDepreciationCents:0,evidenceDate:"2026-04-30",sourceReference:"synthetic CPA workpaper",
   cpaName:"Test CPA",
  });
  expect((await prisma.bookTaxEvidence.findUniqueOrThrow({where:{id:evidence}})).allowedDepreciationCents).toBe(4000);
  const view=await getBookAssets(admin);
  expect(view.assets.find(x=>x.applianceId===id)?.taxEvidence[0]?.confidence).toBe("CPA_CONFIRMED");
  expect(await prisma.journalEntry.count({where:{sourceType:"TAX_FILING",sourceId:id}})).toBe(0);
 });
 it("does not recognize automatic disposal loss when the fleet machine is retired",async()=>{
  await prisma.appliance.update({where:{id},data:{status:"RETIRED"}});
  const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:id}});
  const result=await retireBookAsset(owner,id,asset.version,"SELL","2026-04-30");
  expect(result.carriedCents).toBe(6000);
  await expect(retireBookAsset(owner,id,asset.version,"SELL","2026-04-30")).rejects.toThrow(/changed/);
  const journal=await prisma.journalEntry.findUniqueOrThrow({where:{sourceType_sourceId_eventKind:{
   sourceType:"APPLIANCE",sourceId:id,eventKind:"RETIRED_HELD",
  }},include:{lines:{include:{ledgerAccount:true}}}});
  expect(journal.lines.reduce((n,l)=>n+l.debitCents-l.creditCents,0)).toBe(0);
  expect(journal.lines.some(l=>l.ledgerAccount.systemRole==="RETIRED_PENDING_DISPOSITION"&&l.debitCents===6000)).toBe(true);
  expect(journal.lines.some(l=>l.ledgerAccount.systemRole==="DISPOSAL_LOSS")).toBe(false);
  expect(await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",sourceId:id,eventKind:"APPLIANCE_RETIRED"}})).toBe(0);
  await expect(postBookDepreciation(owner,id,"2026-05")).rejects.toThrow(/Retired/);
 });
});
