import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
const {postPending}=vi.hoisted(()=>({postPending:vi.fn(async()=>({posted:0,problems:[]}))}));
vi.mock("@/domains/books/post",()=>({postPending:()=>postPending()}));
import { runExport, readBookExport, getBookExportHistory } from "@/domains/books/exports";
import { decideQboDelivery, registerQboDelivery, checkedQboIdentity } from "@/domains/books/exports/delivery";
const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(db.hostname)&&
 db.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,12),owner="cash6-owner-"+tag,admin="cash6-admin-"+tag,
 staff="cash6-staff-"+tag,checking="cash6-bank-"+tag,revenue="cash6-revenue-"+tag,
 source="cash6-source-"+tag;
const day=new Date("2026-10-14T06:00:00Z");
const input={target:"QBO_JOURNAL_CSV" as const,mode:"DETAIL" as const,
 from:"2026-10-14",to:"2026-10-14",onlyNotYetExported:true,
 qboTenantLabel:"Practice company "+tag,qboEdition:"OTHER"};
let priorStart:Date|null=null,firstEntry="",extraEntry="";
let originalBatch="",replacementBatch="",firstDelivery="",extraDelivery="";

describe.skipIf(!enabled)("K-CASH-6 QBO accounting delivery under real PostgreSQL",()=>{
 beforeAll(async()=>{
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:admin,email:admin+"@example.test",role:"ADMIN"},
   {id:staff,email:staff+"@example.test",role:"STAFF"},
  ]});
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  priorStart=settings.booksStartDate;
  await prisma.businessSettings.update({where:{id:"singleton"},
   data:{booksStartDate:new Date("2026-01-01T07:00:00Z")}});
  await prisma.ledgerAccount.createMany({data:[
   {id:checking,name:"Trial checking "+tag,type:"ASSET",description:"Practice statement",isPaymentSource:true},
   {id:revenue,name:"Trial income "+tag,type:"INCOME",description:"Practice rent"},
  ]});
  await prisma.accountExportMapping.createMany({data:[
   {ledgerAccountId:checking,target:"QBO_JOURNAL_CSV",externalName:"Practice Checking"},
   {ledgerAccountId:revenue,target:"QBO_JOURNAL_CSV",externalName:"Revenue:Rental"},
  ]});
  const sourceEntry=await prisma.journalEntry.create({data:{
   sourceType:"OPENING",sourceId:source,eventKind:"TRIAL_OPENING",
   periodKey:"2026-10",entryDate:day,memo:"Practice rent journal",
   lines:{create:[{ledgerAccountId:checking,debitCents:10800},
    {ledgerAccountId:revenue,creditCents:10800}]},
  }});
  firstEntry=sourceEntry.id;
 });
 afterAll(async()=>{
  const batches=await prisma.exportBatch.findMany({where:{createdByUserId:owner},select:{id:true}});
  const ids=batches.map(x=>x.id);
  // This test creates a self-referencing replacement chain. Break fixture-only
  // links before disposing samples; product history never uses this path.
  await prisma.accountingDelivery.updateMany({where:{exportBatchId:{in:ids}},data:{replacesDeliveryId:null}});
  await prisma.accountingDelivery.deleteMany({where:{exportBatchId:{in:ids}}});
  await prisma.exportBatchEntry.deleteMany({where:{exportBatchId:{in:ids}}});
  await prisma.exportBatch.deleteMany({where:{id:{in:ids}}});
  await prisma.journalLine.deleteMany({where:{entryId:{in:[firstEntry,extraEntry].filter(Boolean)}}});
  await prisma.journalEntry.deleteMany({where:{id:{in:[firstEntry,extraEntry].filter(Boolean)}}});
  await prisma.accountExportMapping.deleteMany({where:{ledgerAccountId:{in:[checking,revenue]}}});
  await prisma.ledgerAccount.deleteMany({where:{id:{in:[checking,revenue]}}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner,admin,staff]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:priorStart}});
  await prisma.user.deleteMany({where:{id:{in:[owner,admin,staff]}}});
 });
 it("refuses unmapped tenant, invalid mode risk and denied roles without a QBO export",async()=>{
  expect(()=>checkedQboIdentity("   ","OTHER")).toThrow();
  await expect(runExport(staff,input)).rejects.toThrow(/access/);
  await expect(runExport(owner,{...input,qboTenantLabel:" "}))
    .rejects.toThrow(/company label/);
  await expect(runExport(owner,{...input,mode:"DAILY_SUMMARY"}))
    .rejects.toThrow(/daily summary/);
  expect(await prisma.exportBatch.count({where:{createdByUserId:owner}})).toBe(0);
 });
 it("prepares exactly one immutable DETAIL QBO batch and marks the delivery uncertain",async()=>{
  const one=await runExport(owner,input);
  expect("batchId" in one).toBe(true);
  if(!("batchId" in one))throw new Error("Expected new QBO batch.");
  originalBatch=one.batchId;
  const b=await prisma.exportBatch.findUniqueOrThrow({where:{id:one.batchId},
    include:{accountingDelivery:true,entries:true}});
  firstDelivery=b.accountingDelivery!.id;
  expect(b.mode).toBe("DETAIL");
  expect(b.accountingDelivery?.status).toBe("PREPARED");
  expect(b.accountingDelivery?.tenantLabel).toBe(input.qboTenantLabel);
  expect(b.accountingDelivery?.edition).toBe("OTHER");
  expect(b.entries.map(x=>x.journalEntryId)).toEqual([firstEntry]);
  expect(b.content).toContain("Journal No,Journal Date,Account,Debits,Credits,Description");
  expect(b.content).toContain("Revenue:Rental,,108.00");
  expect(createHash("sha256").update(b.content).digest("hex")).toBe(b.contentSha256);
  expect((await readBookExport(admin,b.id)).content).toBe(b.content);
  await expect(readBookExport(staff,b.id)).rejects.toThrow(/access/);
  expect((await getBookExportHistory(admin))[0]?.accountingDelivery?.status).toBe("PREPARED");
 });
 it("quarantines replay, changed window, onlyNew=false and unknown manual delivery",async()=>{
  const blocked=await Promise.all([
   runExport(owner,input),
   runExport(owner,{...input,onlyNotYetExported:false}),
   runExport(owner,{...input,to:"2026-10-15"}),
  ]);
  expect(blocked.every(x=>"blocked" in x)).toBe(true);
  expect(await prisma.exportBatch.count({where:{createdByUserId:owner}})).toBe(1);
  await expect(registerQboDelivery(admin,originalBatch,"Trial company","OTHER"))
   .rejects.toThrow(/access/);
  expect((await registerQboDelivery(owner,originalBatch,input.qboTenantLabel,"OTHER")).existing).toBe(true);
  await expect(decideQboDelivery(admin,{
   deliveryId:firstDelivery,expectedVersion:1,decision:"FAILED_BEFORE_IMPORT",
   reference:"trial import report",note:"Nothing uploaded to trial company.",neverStarted:true,
  })).rejects.toThrow(/access/);
  await expect(decideQboDelivery(owner,{
   deliveryId:firstDelivery,expectedVersion:1,decision:"IMPORT_CONFIRMED",
   reference:"trial-import-reference",note:"No actual journal checks completed.",
   importedCount:1,balanced:false,bankMatched:true,statementChecked:true,
  })).rejects.toThrow(/journal counts/);
  const uncertain=await decideQboDelivery(owner,{
   deliveryId:firstDelivery,expectedVersion:1,decision:"UNCERTAIN",
   reference:"trial-check-pending",note:"The upload outcome has not been established.",
  });
  expect(uncertain).toMatchObject({status:"PREPARED",version:2});
  expect("blocked" in await runExport(owner,input)).toBe(true);
 });
 it("requires complete independent trial-check attestation and prevents stale/repeat contradictory writes",async()=>{
  const review={deliveryId:firstDelivery,expectedVersion:2,
   decision:"IMPORT_CONFIRMED" as const,reference:"trial-import-journals-10",
   note:"Trial counts balanced; trial bank matched and statement compared.",
   importedCount:1,balanced:true,bankMatched:true,statementChecked:true};
  const outcomes=await Promise.allSettled([
   decideQboDelivery(owner,review),decideQboDelivery(owner,review),
  ]);
  expect(outcomes.some(x=>x.status==="fulfilled")).toBe(true);
  expect((await prisma.accountingDelivery.findUniqueOrThrow({where:{id:firstDelivery}})).status).toBe("IMPORT_CONFIRMED");
  expect(await decideQboDelivery(owner,review)).toMatchObject({status:"IMPORT_CONFIRMED",replayed:true});
  await expect(decideQboDelivery(owner,{...review,decision:"FAILED_BEFORE_IMPORT",neverStarted:true}))
    .rejects.toThrow();
  expect(await runExport(owner,input)).toEqual({batchId:originalBatch,alreadyImported:true});
  expect(await prisma.exportBatch.count({where:{createdByUserId:owner}})).toBe(1);
  const check=await decideQboDelivery(owner,{...review,expectedVersion:3,
   decision:"RECONCILIATION_CONFIRMED",note:"Trial statement beginning and closing balances match."});
  expect(check.status).toBe("RECONCILIATION_CONFIRMED");
  expect((await readBookExport(owner,originalBatch)).contentSha256).toMatch(/^[a-f0-9]{64}$/);
 });
 it("only a provably never-started import may be safely retried with immutable predecessor reference",async()=>{
  const second=await prisma.journalEntry.create({data:{
   sourceType:"OPENING",sourceId:source+"-two",eventKind:"TRIAL_SECOND",
   periodKey:"2026-10",entryDate:day,memo:"Another trial expense source",
   lines:{create:[{ledgerAccountId:checking,debitCents:2100},
    {ledgerAccountId:revenue,creditCents:2100}]},
  }});
  extraEntry=second.id;
  let result=await runExport(owner,input);
  expect("batchId" in result).toBe(true);
  if(!("batchId" in result))throw new Error("Expected second QBO delivery.");
  replacementBatch=result.batchId;
  expect(replacementBatch).not.toBe(originalBatch);
  const before=await prisma.accountingDelivery.findUniqueOrThrow({where:{exportBatchId:replacementBatch}});
  extraDelivery=before.id;
  await expect(decideQboDelivery(owner,{deliveryId:extraDelivery,expectedVersion:1,
   decision:"FAILED_BEFORE_IMPORT",reference:"trial-import-failure",
   note:"Could not submit the import and nobody uploaded the CSV."}))
   .rejects.toThrow(/never started/);
  const failed=await decideQboDelivery(owner,{deliveryId:extraDelivery,expectedVersion:1,
   decision:"FAILED_BEFORE_IMPORT",reference:"trial-import-failure",
   note:"Never started upload; selected trial-company import was canceled.",neverStarted:true});
  expect(failed.status).toBe("FAILED_BEFORE_IMPORT");
  result=await runExport(owner,input);
  expect("batchId" in result).toBe(true);
  if(!("batchId" in result))throw new Error("Expected replacement QBO delivery.");
  const next=await prisma.exportBatch.findUniqueOrThrow({where:{id:result.batchId},
   include:{accountingDelivery:true}});
  expect(next.id).not.toBe(replacementBatch);
  expect(next.accountingDelivery?.replacesDeliveryId).toBe(extraDelivery);
  expect(next.contentSha256).toBe((await readBookExport(owner,replacementBatch)).contentSha256);
  expect("blocked" in await runExport(owner,input)).toBe(true);
 });
});
