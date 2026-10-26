import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";
import { runBooksAutopilot } from "@/domains/books/autopilot";
import { enrollBookAsset, postBookDepreciation, postBookDepreciationInTx } from "@/domains/books/fixed-assets";
import { listBooksAttention } from "@/domains/exceptions/books-attention";

const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)
 &&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10),typeId="ba1auto-type-"+tag,eligible="ba1auto-eligible-"+tag;
const noCost="ba1auto-nocost-"+tag;
const longType="ba1auto-long-type-"+tag,longAsset="ba1auto-long-"+tag;
const ids=[eligible,noCost,longAsset];
let original:{booksStartDate:Date|null;booksConsecutiveFailedNights:number;booksLastProblemCount:number;booksLastBroughtUpToDateAt:Date|null};

describe.skipIf(!enabled)("BA-1 nightly recording on disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  original=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{
   booksStartDate:true,booksConsecutiveFailedNights:true,booksLastProblemCount:true,booksLastBroughtUpToDateAt:true,
  }});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:new Date("2026-01-01T07:00:00.000Z"),
  }});
  await prisma.applianceType.create({data:{id:typeId,name:"BA-1 auto washer "+tag,slug:"ba1auto-"+tag,
   depreciationMonths:6}});
  await prisma.applianceType.create({data:{id:longType,name:"BA-1 long-life "+tag,slug:"ba1-long-"+tag,depreciationMonths:360}});
  await prisma.appliance.createMany({data:[
   {id:eligible,assetNumber:"BA1-AUTO-"+tag,applianceTypeId:typeId,
    acquisitionCostCents:12000,purchaseDate:new Date("2025-12-15T07:00:00.000Z"),status:"AVAILABLE"},
   {id:noCost,assetNumber:"BA1-MISSING-"+tag,applianceTypeId:typeId,status:"AVAILABLE"},
  ]});
 });
 afterAll(async()=>{
  await prisma.booksProblem.deleteMany({where:{subjectId:{in:ids}}});
  await prisma.bookAsset.deleteMany({where:{applianceId:{in:ids}}});
  const entries=await prisma.journalEntry.findMany({where:{sourceType:"APPLIANCE",sourceId:{in:ids}},
   select:{id:true}});
  await prisma.journalLine.deleteMany({where:{entryId:{in:entries.map(e=>e.id)}}});
  await prisma.journalEntry.deleteMany({where:{sourceType:"APPLIANCE",sourceId:{in:ids}}});
  await prisma.auditLog.deleteMany({where:{entityType:"BookAsset",entityId:{in:ids}}});
  await prisma.appliance.deleteMany({where:{id:{in:ids}}});
  await prisma.applianceType.deleteMany({where:{id:{in:[typeId,longType]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:original});
 });
 it("records a previously purchased machine from the Books start date without manual enrollment",async()=>{
  const result=await runBooksAutopilot(new Date("2026-05-05T15:00:00Z"));
  expect(result.enrolled).toBeGreaterThanOrEqual(1);
  const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:eligible}});
  expect(asset.enrollmentSource).toBe("AUTOMATIC");
  expect(businessDateKey(asset.placedInServiceOn)).toBe("2026-01-01");
  expect(asset.lastDepreciationMonth).toBe("2026-04");
  const count=await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",sourceId:eligible,
   eventKind:{startsWith:"DEPRECIATION:"}}});
  expect(count).toBe(3);
  await runBooksAutopilot(new Date("2026-05-05T15:00:00Z"));
  expect(await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",sourceId:eligible,
   eventKind:{startsWith:"DEPRECIATION:"}}})).toBe(count);
 });
 it("catches up a full 360-month useful life in one authorized automatic transaction",async()=>{
  // An old machine predates today's business. This isolated fixture moves only
  // the throwaway database's start date and restores it in the finally block.
  const start=new Date("1990-01-01T07:00:00Z");
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:start}});
  try{
   // Create only in this test; an earlier nightly run must not auto-enroll it
   // with the later 2026 start date.
   await prisma.appliance.create({data:{
    id:longAsset,assetNumber:"BA1-LONG-"+tag,applianceTypeId:longType,
    purchaseDate:new Date("1990-01-15T07:00:00Z"),acquisitionCostCents:36,status:"AVAILABLE",
   }});
   const owner=await prisma.user.findFirstOrThrow({where:{role:"OWNER"},select:{id:true}});
   await enrollBookAsset(owner.id,longAsset,"1990-01-15");
   const result=await prisma.$transaction(
    tx=>postBookDepreciationInTx(tx,{kind:"automatic"},longAsset,"2020-01",{maxMonths:360}),
    {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
   expect(result.lastCompleted).toBe("2020-01");
   expect(result.posted).toBeGreaterThan(0);
   const asset=await prisma.bookAsset.findUniqueOrThrow({where:{applianceId:longAsset}});
   expect(asset.lastDepreciationMonth).toBe("2020-01");
   expect(asset.fullyDepreciatedOn).not.toBeNull();
   const count=await prisma.journalEntry.count({where:{
    sourceType:"APPLIANCE",sourceId:longAsset,eventKind:{startsWith:"DEPRECIATION:"}}});
   expect(count).toBe(result.posted);
   const again=await prisma.$transaction(
    tx=>postBookDepreciationInTx(tx,{kind:"automatic"},longAsset,"2020-01",{maxMonths:360}),
    {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
   expect(again.posted).toBe(0);
   expect(await prisma.journalEntry.count({where:{
    sourceType:"APPLIANCE",sourceId:longAsset,eventKind:{startsWith:"DEPRECIATION:"}}})).toBe(count);
  }finally{
   await prisma.businessSettings.update({where:{id:"singleton"},data:{
    booksStartDate:new Date("2026-01-01T07:00:00Z"),
   }});
  }
 });
 it("manual and automatic posting race for the same month without creating duplicate financial entries",async()=>{
  const owner=await prisma.user.findFirstOrThrow({where:{role:"OWNER"},select:{id:true}});
  const result=await Promise.allSettled([
   postBookDepreciation(owner.id,eligible,"2026-05"),
   prisma.$transaction(tx=>postBookDepreciationInTx(tx,{kind:"automatic"},
    eligible,"2026-05",{maxMonths:360}),{
     isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000,
   }),
  ]);
  expect(result.some(x=>x.status==="fulfilled")).toBe(true);
  expect(await prisma.journalEntry.count({where:{sourceType:"APPLIANCE",
   sourceId:eligible,eventKind:"DEPRECIATION:2026-05"}})).toBe(1);
 });
 it("does not enroll a missing-price appliance, leaving a single visible To do issue",async()=>{
  expect(await prisma.bookAsset.findUnique({where:{applianceId:noCost}})).toBeNull();
  expect(await prisma.booksProblem.count({where:{kind:"APPLIANCE_NOT_ENROLLED",subjectId:noCost,
   resolvedAt:null}})).toBe(1);
  const items=await listBooksAttention(new Date("2026-05-05T15:00:00Z"));
  expect(items.filter(i=>i.href===`/desk/inventory/${noCost}`)).toHaveLength(1);
 });
});
