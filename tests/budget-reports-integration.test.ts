import { randomUUID } from "node:crypto";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { previewMonthlyBudget,publishMonthlyBudget,getMonthlyPublishedVersions,
 saveMonthEndReview,getMonthEndReviews,getMonthEndReviewById } from "@/domains/budget/published";
import { getBudgetMonthReport,getFinanceTrends,financeReportCsv } from "@/domains/budget/reports";
import { BACKUP_TABLES } from "@/domains/backup/manifest";
import { buildDatabaseBackupSnapshot } from "@/domains/backup";
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)
 &&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10);
const month="2026-09",date=(d:string)=>businessDateFromKey(d)!;
const envelope="k7r-envelope-"+tag,planId="k7r-plan-"+tag,targetId="k7r-target-"+tag;
const income="k7r-income-"+tag,expense="k7r-expense-"+tag,bank="k7r-bank-"+tag;
const reason="Reviewed completely synthetic budget publishing evidence.";
let owner="",admin="",staff="",priorBooks:Date|null=null,priorRevision=BigInt(1);
let originalId="",secondId="",reviewId="";
const journalIds:string[]=[];

describe.skipIf(!enabled)("K-CASH-7 immutable monthly publication, report ties and roles (throwaway Postgres)",()=>{
 beforeAll(async()=>{
  const users=await prisma.user.findMany({where:{archivedAt:null,role:{in:["OWNER","ADMIN","STAFF"]}},select:{id:true,role:true}});
  owner=users.find(x=>x.role==="OWNER")?.id??"";
  admin=users.find(x=>x.role==="ADMIN")?.id??"";
  staff=users.find(x=>x.role==="STAFF")?.id??"";
  if(!owner||!admin||!staff)throw new Error("CI seed roles are missing; never fall back to a production user.");
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  priorBooks=settings.booksStartDate;
  priorRevision=(await prisma.budgetState.findUniqueOrThrow({where:{id:"singleton"}})).revision;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:date("2026-01-01")}});
  await prisma.budgetEnvelope.create({data:{id:envelope,name:"Budget reporting sample =safe",groupLabel:"Practice"}});
  await prisma.budgetCostPlan.create({data:{id:planId,envelopeId:envelope,
   name:"Quarterly computer renewal",amountCents:2400,amountQuality:"EXACT",
   dueOn:date("2026-09-15"),recurrence:"NONE",anchorDay:15}});
  await prisma.budgetCostOccurrence.create({data:{planId,dueOn:date("2026-09-15"),amountCents:2400}});
  await prisma.budgetTarget.create({data:{id:targetId,envelopeId:envelope,
   kind:"MONTHLY_SPEND",amountCents:4500}});
  await prisma.ledgerAccount.createMany({data:[
   {id:income,name:"=Test rent income "+tag,type:"INCOME",description:"Signed sample income"},
   {id:expense,name:"Practice bill "+tag,type:"EXPENSE",description:"Signed sample cost"},
   {id:bank,name:"Practice bank "+tag,type:"ASSET",description:"Practice bank"}
  ]});
  const equity=(await prisma.ledgerAccount.findFirstOrThrow({where:{systemRole:"OWNER_CONTRIBUTIONS"}})).id;
  const make=async(key:string,side:{id:string;debit?:number;credit?:number}[])=>{
   const entry=await prisma.journalEntry.create({data:{
    sourceType:"OPENING",sourceId:"k7r-"+key+"-"+tag,eventKind:"REPORT_TRIAL",
    entryDate:date("2026-09-15"),periodKey:month,memo:"Practice K-CASH-7 journal",
    lines:{create:side.map(x=>({ledgerAccountId:x.id,debitCents:x.debit??0,creditCents:x.credit??0}))}
   }});
   journalIds.push(entry.id);
  };
  await make("rent",[{id:bank,debit:12000},{id:income,credit:12000}]);
  await make("cost",[{id:expense,debit:2500},{id:bank,credit:2500}]);
  await make("equity",[{id:equity,debit:900},{id:bank,credit:900}]);
 });
 afterAll(async()=>{
  // Published and reviewed snapshots are SQL-immutable by design. This test
  // intentionally retains those records only in a *throwaway* CI database;
  // no provider or production table is ever contacted, and CI drops it.
  await prisma.journalLine.deleteMany({where:{entryId:{in:journalIds}}});
  await prisma.journalEntry.deleteMany({where:{id:{in:journalIds}}});
  await prisma.ledgerAccount.deleteMany({where:{id:{in:[income,expense,bank]}}});
  await prisma.budgetCostOccurrence.deleteMany({where:{planId}});
  await prisma.budgetCostPlan.deleteMany({where:{id:planId}});
  await prisma.budgetTarget.deleteMany({where:{id:targetId}});
  await prisma.budgetEnvelope.deleteMany({where:{id:envelope}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:priorBooks}});
  await prisma.budgetState.update({where:{id:"singleton"},data:{revision:priorRevision}});
 });
 it("adds two immutable report models to backup tables and leaves budget cash switch OFF",async()=>{
  expect(BACKUP_TABLES).toEqual(expect.arrayContaining(["budgetPlanVersion","budgetReviewSnapshot"]));
  expect((await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}})).cashBudgetEnabled).toBe(false);
  expect(await prisma.budgetPlanVersion.count({where:{monthKey:month}})).toBe(0);
  expect(await prisma.budgetReviewSnapshot.count({where:{monthKey:month}})).toBe(0);
  await expect(previewMonthlyBudget(staff,month)).rejects.toThrow(/access/);
 });
 it("previews dated cost separately from target savings, with safe source revisions",async()=>{
  const draft=await previewMonthlyBudget(owner,month);
  const row=draft.rows.find(x=>x.envelopeId===envelope);
  expect(row).toMatchObject({plannedSpendCents:2400,plannedFundCents:4500,
   sourceOccurrenceIds:[expect.any(String)],amountQuality:"EXACT"});
  expect(draft.latest).toBeNull();
  expect(draft.draftHash).toMatch(/^[0-9a-f]{64}$/);
 });
 it("publishes once and reruns with idempotency, rejects staff/admin, stale and changed operation",async()=>{
  const draft=await previewMonthlyBudget(owner,month);
  const input={month,expectedBudgetRevision:draft.sourceBudgetRevision,expectedBookRevision:draft.sourceBookRevision,
   expectedVersion:0,draftHash:draft.draftHash,commandKey:"month-k7-"+tag,
   note:reason,confirmReviewed:true,rows:draft.rows.map(r=>({
    envelopeId:r.envelopeId,plannedSpendCents:r.plannedSpendCents,
    plannedFundCents:r.plannedFundCents,amountQuality:r.amountQuality
   }))};
  await expect(publishMonthlyBudget(admin,input)).rejects.toThrow(/access/);
  await expect(publishMonthlyBudget(staff,input)).rejects.toThrow(/access/);
  const settled=await Promise.allSettled([
   publishMonthlyBudget(owner,input),publishMonthlyBudget(owner,input)]);
  expect(settled.some(x=>x.status==="fulfilled"),
   settled.map(x=>x.status==="rejected"?String(x.reason):"fulfilled").join(" | ")).toBe(true);
  const versions=await getMonthlyPublishedVersions(owner,month);
  expect(versions).toHaveLength(1);
  originalId=versions[0]!.id;
  expect(versions[0]!.payload.rows.find(x=>x.envelopeId===envelope)).toMatchObject({
   plannedSpendCents:2400,plannedFundCents:4500});
  expect(await publishMonthlyBudget(owner,input)).toMatchObject({id:originalId,replayed:true});
  await expect(publishMonthlyBudget(owner,{...input,note:"Other published reasoning, should fail"}))
   .rejects.toThrow(/different plan/);
  await expect(prisma.budgetPlanVersion.update({where:{id:originalId},data:{note:"Tamper attempt"}}))
   .rejects.toThrow();
  await expect(prisma.budgetPlanVersion.delete({where:{id:originalId}})).rejects.toThrow();
  expect(await getMonthlyPublishedVersions(admin,month)).toHaveLength(1);
  await expect(getMonthlyPublishedVersions(staff,month)).rejects.toThrow(/access/);
 });
 it("preserves the original version on reasoned OWNER revision and rejects wrong amount quality",async()=>{
  const draft=await previewMonthlyBudget(owner,month);
  const rows=draft.rows.map(r=>({
   envelopeId:r.envelopeId,plannedSpendCents:r.envelopeId===envelope?3000:r.plannedSpendCents,
   plannedFundCents:r.plannedFundCents,amountQuality:r.amountQuality as "EXACT"|"ESTIMATE"|"OWNER_REVIEWED",
  }));
  const input={month,expectedBudgetRevision:draft.sourceBudgetRevision,expectedBookRevision:draft.sourceBookRevision,
   expectedVersion:1,draftHash:draft.draftHash,commandKey:"revise-k7-"+tag,
   note:"Published revised cost after owner reviewed source contract.",confirmReviewed:true,rows};
  await expect(publishMonthlyBudget(owner,input)).rejects.toThrow(/Owner reviewed quality/);
  rows.find(x=>x.envelopeId===envelope)!.amountQuality="OWNER_REVIEWED";
  const changed=await publishMonthlyBudget(owner,input);
  secondId=changed.id;
  expect(changed.version).toBe(2);
  const originals=await getMonthlyPublishedVersions(owner,month);
  expect(originals.map(x=>x.version)).toEqual([2,1]);
  expect(originals[1]!.payload.rows.find(x=>x.envelopeId===envelope)?.plannedSpendCents).toBe(2400);
  expect(originals[0]!.payload.rows.find(x=>x.envelopeId===envelope)?.plannedSpendCents).toBe(3000);
  await expect(publishMonthlyBudget(owner,{...input,commandKey:"stale-k7-"+tag}))
   .rejects.toThrow(/Another monthly version/);
 });
 it("compares posted journal income/expenses, not target funding, and supports different drilldown sizes",async()=>{
  const report=await getBudgetMonthReport(owner,{month,planId:secondId,page:1,pageSize:10});
  expect(report.published?.version).toBe(2);
  expect(report.envelopes.find(x=>x.id===envelope)?.plannedSpendCents).toBe(3000);
  expect(report.profit).toMatchObject({revenueCents:12000,costCents:2500,netProfitCents:9500});
  expect(report.unclassifiedCents).toBeGreaterThanOrEqual(0);
  expect(report.sourceCount).toBeGreaterThanOrEqual(6);
  const large=await getBudgetMonthReport(admin,{month,planId:originalId,page:1,pageSize:100});
  expect(large.sourceCount).toBe(report.sourceCount);
  expect(large.sourcePage.rows.length).toBe(report.sourceCount);
  expect(large.published?.version).toBe(1);
  await expect(getBudgetMonthReport(staff,{month})).rejects.toThrow(/access/);
 });
 it("exports all actual journal lines with CSV injection protection and signed totals",async()=>{
  const r=await getFinanceTrends(owner,{asOf:"2026-09-30",months:12,period:"CUSTOM",
   from:"2026-09-01",to:"2026-09-30",pageSize:10});
  expect(r.profit).toMatchObject({revenueCents:12000,costCents:2500,netProfitCents:9500});
  expect(r.sourcePage.totalRows).toBeGreaterThanOrEqual(6);
  const file=await financeReportCsv(owner,{asOf:"2026-09-30",months:12,
   period:"CUSTOM",from:"2026-09-01",to:"2026-09-30"});
  expect(file.content).toContain("'=Test rent income");
  expect(file.content).toContain("Book report (not QuickBooks import)");
  expect(file.sourceRows).toBe(r.sourcePage.totalRows);
  await expect(financeReportCsv(staff)).rejects.toThrow(/access/);
 });
 it("keeps dated review snapshots hash-secured, truthful about incomplete sources, and source-stale",async()=>{
  const report=await getBudgetMonthReport(owner,{month,planId:secondId});
  const input={month,planId:secondId,commandKey:"review-k7-"+tag,
   reason:"Evidence checked but statement and QBO imports need external review.",
   confirmReviewed:true,expectedBudgetRevision:report.budgetRevision,
   expectedBookRevision:report.sourceRevision};
  await expect(saveMonthEndReview(admin,input)).rejects.toThrow(/access/);
  const saved=await saveMonthEndReview(owner,input);
  reviewId=saved.id;
  expect(await saveMonthEndReview(owner,input)).toMatchObject({id:reviewId,replayed:true});
  await expect(saveMonthEndReview(owner,{...input,reason:"Changed report decision under reused operation identity"}))
   .rejects.toThrow(/different inputs/);
  expect((await getMonthEndReviews(owner,month))).toHaveLength(1);
  expect(await getMonthEndReviewById(owner,reviewId)).toMatchObject({
   month,stale:false,content:{planVersion:2}});
  await expect(getMonthEndReviewById(staff,reviewId)).rejects.toThrow(/access/);
  await expect(prisma.budgetReviewSnapshot.delete({where:{id:reviewId}})).rejects.toThrow();
  await prisma.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  expect((await getMonthEndReviews(owner,month))[0]?.stale).toBe(true);
  expect((await getMonthlyPublishedVersions(owner,month))[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  const snapshot=await buildDatabaseBackupSnapshot();
  expect(snapshot.payload.tables.budgetPlanVersion).toBeInstanceOf(Array);
  expect(snapshot.payload.tables.budgetReviewSnapshot).toBeInstanceOf(Array);
  expect(snapshot.payload.tables.budgetReviewSnapshot.some(x=>typeof x==="object"&&x!==null&&"id" in x&&x.id===reviewId)).toBe(true);
  expect(snapshot.payload.tables.budgetPlanVersion.some(x=>typeof x==="object"&&x!==null&&"id" in x&&x.id===originalId)).toBe(true);
 });

 it("restores original, superseded and reviewed immutable financial evidence into a fresh migrated disposable database",async()=>{
  expect(originalId).toBeTruthy();expect(secondId).toBeTruthy();expect(reviewId).toBeTruthy();
  const database="appliance_desk_restore_k7_"+tag;
  const adminUrl=new URL(process.env.DATABASE_URL!);adminUrl.pathname="/postgres";
  const restoredUrl=new URL(process.env.DATABASE_URL!);restoredUrl.pathname="/"+database;
  const client=new Client({connectionString:adminUrl.toString()});
  const folder=await mkdtemp(path.join(tmpdir(),"k7-plan-restore-"));
  let created=false,connected=false,restored:PrismaClient|undefined;
  try{
   const backup=await buildDatabaseBackupSnapshot();
   expect(backup.payload.tables.budgetPlanVersion).toBeInstanceOf(Array);
   expect(backup.payload.tables.budgetReviewSnapshot).toBeInstanceOf(Array);
   const file=path.join(folder,"immutable-k7.json");
   await writeFile(file,JSON.stringify(backup.payload));
   await client.connect();connected=true;
   await client.query('CREATE DATABASE "'+database+'"');created=true;
   await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs",
    "scripts/restore-backup.ts",file,"--into",restoredUrl.toString()],
    {timeout:120000,maxBuffer:3*1024*1024});
   restored=new PrismaClient({adapter:new PrismaPg({connectionString:restoredUrl.toString()})});
   const first=await restored.budgetPlanVersion.findUniqueOrThrow({where:{id:originalId}});
   const second=await restored.budgetPlanVersion.findUniqueOrThrow({where:{id:secondId}});
   const review=await restored.budgetReviewSnapshot.findUniqueOrThrow({where:{id:reviewId}});
   expect(first).toMatchObject({version:1,supersedesId:null,monthKey:month});
   expect(second).toMatchObject({version:2,supersedesId:originalId,monthKey:month});
   expect(review).toMatchObject({monthKey:month,sha256:expect.stringMatching(/^[0-9a-f]{64}$/)});
   expect((first.payload as unknown as {rows:{envelopeId:string;plannedSpendCents:number}[]}).rows
    .find(x=>x.envelopeId===envelope)?.plannedSpendCents).toBe(2400);
   expect((second.payload as {rows:{envelopeId:string;plannedSpendCents:number}[]}).rows
    .find(x=>x.envelopeId===envelope)?.plannedSpendCents).toBe(3000);
   await expect(restored.budgetPlanVersion.update({where:{id:first.id},data:{note:"Tampering after recovery"}}))
    .rejects.toThrow(/immutable/);
   await expect(restored.budgetReviewSnapshot.delete({where:{id:review.id}}))
    .rejects.toThrow(/immutable/);
  }finally{
   await restored?.$disconnect();
   if(created&&connected)await client.query('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)');
   if(connected)await client.end();
   await rm(folder,{recursive:true,force:true});
  }
 },120000);
});
