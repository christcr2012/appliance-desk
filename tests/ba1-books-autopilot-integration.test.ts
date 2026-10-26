import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { enrollBookAsset, disposedValueBefore, writeOffRetiredBookAssetInTx } from "@/domains/books/fixed-assets";
import { retireAppliance } from "@/domains/inventory/guided-actions";
import { setRetiredPlan, completeRetiredPlan, reopenRetiredPlan } from "@/domains/inventory/retired-plans";

const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)
 &&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10),owner="ba1-owner-"+tag,admin="ba1-admin-"+tag;
const typeId="ba1-type-"+tag,asset="ba1-asset-"+tag,broken="ba1-broken-"+tag,unenrolled="ba1-before-enrolled-"+tag;
const bought=new Date("2026-01-15T07:00:00.000Z");
let original:{booksStartDate:Date|null;depreciationMonthsDefault:number;depreciationSalvagePercent:number;
 booksConsecutiveFailedNights:number;booksLastProblemCount:number;booksLastBroughtUpToDateAt:Date|null};

describe.skipIf(!enabled)("BA-1 append-only appliance disposal on disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  original=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{
   booksStartDate:true,depreciationMonthsDefault:true,depreciationSalvagePercent:true,
   booksConsecutiveFailedNights:true,booksLastProblemCount:true,booksLastBroughtUpToDateAt:true,
  }});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:new Date("2026-01-01T07:00:00Z"),
   depreciationMonthsDefault:12,depreciationSalvagePercent:0,
  }});
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:admin,email:admin+"@example.test",role:"ADMIN"},
  ]});
  await prisma.applianceType.create({data:{id:typeId,name:"BA1 appliance "+tag,slug:"ba1-"+tag}});
  await prisma.appliance.createMany({data:[
   {id:asset,assetNumber:"BA1-"+tag,applianceTypeId:typeId,
    acquisitionCostCents:12000,purchaseDate:bought,status:"AVAILABLE"},
   {id:broken,assetNumber:"BA1-B-"+tag,applianceTypeId:typeId,
    acquisitionCostCents:12000,purchaseDate:bought,status:"AVAILABLE"},
   {id:unenrolled,assetNumber:"BA1-U-"+tag,applianceTypeId:typeId,
    acquisitionCostCents:12500,purchaseDate:bought,status:"AVAILABLE"},
  ]});
 });
 afterAll(async()=>{
  const ids=[asset,broken,unenrolled];
  await prisma.retiredAppliancePlan.deleteMany({where:{applianceId:{in:ids}}});
  await prisma.booksProblem.deleteMany({where:{subjectType:"APPLIANCE",subjectId:{in:ids}}});
  await prisma.bookTaxEvidence.deleteMany({where:{applianceId:{in:ids}}});
  await prisma.bookAsset.deleteMany({where:{applianceId:{in:ids}}});
  const entries=await prisma.journalEntry.findMany({where:{sourceType:"APPLIANCE",sourceId:{in:ids}},select:{id:true}});
  await prisma.journalLine.deleteMany({where:{entryId:{in:entries.map(x=>x.id)}}});
  await prisma.journalEntry.deleteMany({where:{sourceType:"APPLIANCE",sourceId:{in:ids}}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,admin]}}});
  await prisma.appliance.deleteMany({where:{id:{in:ids}}});
  await prisma.applianceType.deleteMany({where:{id:typeId}});
  await prisma.user.deleteMany({where:{id:{in:[owner,admin]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:original});
 });
 it("retires an enrolled appliance through Equipment, preserving the value until its plan ends",async()=>{
  await enrollBookAsset(owner,asset,"2026-01-15");
  await retireAppliance(admin,asset,"Cost to repair exceeds its remaining value.");
  const row=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:asset}});
  expect(row.retiredOn).not.toBeNull();
  expect(row.retiredValueCents).toBeGreaterThan(0);
  expect(await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",sourceId:asset,
   eventKind:"RETIRED_HELD"}})).toBe(1);
  expect(await prisma.booksProblem.count({where:{subjectId:asset,resolvedAt:null}})).toBe(0);
 });
 it("rejects a disposal date earlier than book retirement without changing journals",async()=>{
  const prior=new Date("2026-01-18T07:00:00.000Z");
  await expect(prisma.$transaction(tx=>writeOffRetiredBookAssetInTx(
   tx,{kind:"equipment",userId:owner},asset,prior,"scrap"),
  )).rejects.toThrow(/before the recorded retirement/i);
  expect(await prisma.journalEntry.count({where:{
   sourceType:"APPLIANCE",sourceId:asset,eventKind:{startsWith:"DISPOSED:"},
  }})).toBe(0);
 });
 it("retires an unenrolled acquired appliance without hiding missing disposal accounting",async()=>{
  expect(await prisma.bookAsset.findUnique({where:{applianceId:unenrolled}})).toBeNull();
  await retireAppliance(admin,unenrolled,"Unsafe for further use.");
  expect((await prisma.appliance.findUniqueOrThrow({where:{id:unenrolled}})).status).toBe("RETIRED");
  const key={kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",subjectType:"APPLIANCE",subjectId:unenrolled};
  expect(await prisma.booksProblem.count({where:{...key,resolvedAt:null}})).toBe(1);
  await setRetiredPlan(owner,unenrolled,{choice:"SCRAP"});
  await completeRetiredPlan(owner,unenrolled,{doneOnKey:businessDateKey(new Date())});
  expect(await prisma.bookAsset.findUnique({where:{applianceId:unenrolled}})).toBeNull();
  expect(await prisma.booksProblem.count({where:{...key,resolvedAt:null}})).toBe(1);
  expect(await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",
   sourceId:unenrolled,eventKind:{startsWith:"DISPOSED:"}}})).toBe(0);
 });
 it("finishing, reopening and finishing again produces exactly three balanced cycle journals",async()=>{
  await setRetiredPlan(owner,asset,{choice:"SCRAP"});
  const day=businessDateKey(new Date());
  await completeRetiredPlan(owner,asset,{doneOnKey:day});
  await reopenRetiredPlan(owner,asset,"Correcting the reported disposal date");
  await completeRetiredPlan(owner,asset,{doneOnKey:day});
  await completeRetiredPlan(owner,asset,{doneOnKey:day});
  const rows=await prisma.journalEntry.findMany({
   where:{sourceType:"APPLIANCE",sourceId:asset,eventKind:{in:[
    "DISPOSED:1","DISPOSAL_REVERSED:1","DISPOSED:2"]}},
   include:{lines:true},
  });
  expect(rows.map(r=>r.eventKind).sort()).toEqual([
   "DISPOSAL_REVERSED:1","DISPOSED:1","DISPOSED:2"]);
  for(const entry of rows)expect(entry.lines.reduce((v,l)=>v+l.debitCents-l.creditCents,0)).toBe(0);
  const row=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:asset}});
  expect(row.disposalCycle).toBe(2);
  const before=await prisma.$transaction(tx=>disposedValueBefore(tx,new Date(Date.now()+86400000)));
  expect(before.get(asset)).toBe(row.retiredValueCents);
 });
 it("a wrong acquisition cost does not prevent Equipment retirement and leaves one actionable problem",async()=>{
  await enrollBookAsset(owner,broken,"2026-01-15");
  await prisma.appliance.update({where:{id:broken},data:{acquisitionCostCents:13000}});
  await retireAppliance(owner,broken,"No longer safe for rental service.");
  expect((await prisma.appliance.findUniqueOrThrow({where:{id:broken}})).status).toBe("RETIRED");
  expect((await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:broken}})).retiredOn).toBeNull();
  expect(await prisma.booksProblem.count({where:{kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",
   subjectType:"APPLIANCE",subjectId:broken,resolvedAt:null}})).toBe(1);
 });
});
