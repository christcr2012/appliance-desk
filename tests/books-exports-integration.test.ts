import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const {postPending}=vi.hoisted(()=>({postPending:vi.fn(async()=>({posted:0,problems:[]}))}));
vi.mock("@/domains/books/post",()=>({postPending:(args:unknown)=>postPending(args)}));
import { runExport, getBookExportHistory, readBookExport } from "@/domains/books/exports";

const db=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true" && ["localhost","127.0.0.1"].includes(db.hostname) &&
 db.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,12),owner="k5-owner-"+tag,staff="k5-staff-"+tag;
const bank="k5-bank-"+tag,income="k5-income-"+tag, source="k5-source-"+tag;
const date=new Date("2026-10-16T06:00:00.000Z");
let entryId="",priorStart:Date|null=null;
const period={from:"2026-10-16",to:"2026-10-16"};
describe.skipIf(!enabled)("K-5 immutable exports in disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:staff,email:staff+"@example.test",role:"STAFF"},
  ]});
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  priorStart=settings.booksStartDate;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:new Date("2026-01-01T07:00:00Z"),
  }});
  await prisma.ledgerAccount.createMany({data:[
   {id:bank,name:"K5 checking "+tag,description:"Practice checking",type:"ASSET",isPaymentSource:true},
   {id:income,name:"K5 revenue "+tag,description:"Practice income",type:"INCOME"},
  ]});
  const entry=await prisma.journalEntry.create({data:{
   sourceType:"OPENING",sourceId:source,eventKind:"K5_SYNTHETIC",periodKey:"2026-10",
   entryDate:date,memo:"Practice bookkeeping row",lines:{create:[
    {ledgerAccountId:bank,debitCents:12840},
    {ledgerAccountId:income,creditCents:12840},
   ]},
  }});
  entryId=entry.id;
 });
 afterAll(async()=>{
  const batches=await prisma.exportBatch.findMany({where:{createdByUserId:owner},select:{id:true}});
  await prisma.exportBatchEntry.deleteMany({where:{exportBatchId:{in:batches.map(x=>x.id)}}});
  await prisma.exportBatch.deleteMany({where:{createdByUserId:owner}});
  await prisma.journalLine.deleteMany({where:{entryId}});
  await prisma.journalEntry.deleteMany({where:{id:entryId}});
  await prisma.accountExportMapping.deleteMany({where:{ledgerAccountId:{in:[bank,income]}}});
  await prisma.ledgerAccount.deleteMany({where:{id:{in:[bank,income]}}});
  await prisma.auditLog.deleteMany({where:{userId:owner}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:priorStart}});
  await prisma.user.deleteMany({where:{id:{in:[owner,staff]}}});
 });
 it("enforces current live team roles and rejects invalid windows before posting",async()=>{
  await expect(runExport(staff,{...period,target:"QBO_JOURNAL_CSV",mode:"DETAIL",onlyNotYetExported:true}))
   .rejects.toThrow(/access/);
  await expect(runExport("unknown-user",{...period,target:"QBO_JOURNAL_CSV",mode:"DETAIL",onlyNotYetExported:true}))
   .rejects.toThrow(/access/);
  await expect(runExport(owner,{from:"2026-02-30",to:"2026-03-01",
    target:"QBO_JOURNAL_CSV",mode:"DETAIL",onlyNotYetExported:true})).rejects.toThrow(/real Colorado/);
  await expect(runExport(owner,{from:"2025-01-01",to:"2026-10-16",
    target:"QBO_JOURNAL_CSV",mode:"DETAIL",onlyNotYetExported:true})).rejects.toThrow(/366/);
 });
 it("refuses unmapped accounts without creating a partial batch",async()=>{
  const x=await runExport(owner,{...period,target:"QBO_JOURNAL_CSV",mode:"DETAIL",onlyNotYetExported:true});
  expect("blocked" in x && x.blocked.some(s=>s.includes("Map an active account"))).toBe(true);
  expect(await prisma.exportBatch.count({where:{createdByUserId:owner}})).toBe(0);
 });
 it("locks and archives one batch for replayed same-target concurrent export requests",async()=>{
  await prisma.accountExportMapping.createMany({data:[
   {ledgerAccountId:bank,target:"QBO_JOURNAL_CSV",externalName:"1000"},
   {ledgerAccountId:income,target:"QBO_JOURNAL_CSV",externalName:"4000"},
  ]});
  const input={...period,target:"QBO_JOURNAL_CSV" as const,mode:"DETAIL" as const,onlyNotYetExported:true};
  const results=await Promise.allSettled(Array.from({length:4},()=>runExport(owner,input)));
  expect(results.some(x=>x.status==="fulfilled")).toBe(true);
  const batches=await prisma.exportBatch.findMany({where:{createdByUserId:owner,target:"QBO_JOURNAL_CSV"}});
  expect(batches).toHaveLength(1);
  expect(batches[0]!.entryCount).toBe(1);
  expect(createHash("sha256").update(batches[0]!.content).digest("hex")).toBe(batches[0]!.contentSha256);
  const links=await prisma.exportBatchEntry.findMany({where:{exportBatchId:batches[0]!.id}});
  expect(links.map(x=>x.journalEntryId)).toEqual([entryId]);
  expect((await readBookExport(owner,batches[0]!.id)).content).toBe(batches[0]!.content);
  await expect(readBookExport(staff,batches[0]!.id)).rejects.toThrow(/access/);
  expect((await getBookExportHistory(owner)).map(x=>x.id)).toContain(batches[0]!.id);
 });
 it("does not repeat a target-scoped journal but permits a different target",async()=>{
  const input={...period,target:"QBO_JOURNAL_CSV" as const,mode:"DETAIL" as const,onlyNotYetExported:true};
  const repeat=await runExport(owner,input);
  expect("batchId" in repeat).toBe(true);
  expect(await prisma.exportBatch.count({where:{createdByUserId:owner,target:"QBO_JOURNAL_CSV"}})).toBe(1);
  await prisma.accountExportMapping.createMany({data:[
   {ledgerAccountId:bank,target:"GENERIC_JOURNAL_CSV",externalName:"Bank export"},
   {ledgerAccountId:income,target:"GENERIC_JOURNAL_CSV",externalName:"Rental export"},
  ]});
  const other=await runExport(owner,{...input,target:"GENERIC_JOURNAL_CSV"});
  expect("batchId" in other).toBe(true);
  expect(await prisma.exportBatch.count({where:{createdByUserId:owner}})).toBe(2);
 });
 it("honors target-specific payout exclusion without mutating prior exports",async()=>{
  const payout=await prisma.journalEntry.create({data:{
   sourceType:"STRIPE_BALANCE_TXN",sourceId:source+"-payout",eventKind:"STRIPE_PAYOUT",
   periodKey:"2026-10",entryDate:date,memo:"Synthetic clearing transfer",
   lines:{create:[{ledgerAccountId:bank,debitCents:100},{ledgerAccountId:income,creditCents:100}]},
  }});
  const old=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{exportPayoutLines:true}});
  const input={...period,target:"QBO_JOURNAL_CSV" as const,mode:"DETAIL" as const,onlyNotYetExported:false};
  try{
   await prisma.businessSettings.update({where:{id:"singleton"},data:{exportPayoutLines:{"QBO_JOURNAL_CSV":false}}});
   const skipped=await runExport(owner,input);
   expect("batchId" in skipped).toBe(true);
   const before=await prisma.exportBatch.findUniqueOrThrow({where:{id:(skipped as {batchId:string}).batchId}});
   expect(before.content).not.toContain("Synthetic clearing transfer");
   await prisma.businessSettings.update({where:{id:"singleton"},data:{exportPayoutLines:{"QBO_JOURNAL_CSV":true}}});
   const included=await runExport(owner,input);
   expect("batchId" in included).toBe(true);
   const after=await prisma.exportBatch.findUniqueOrThrow({where:{id:(included as {batchId:string}).batchId}});
   expect(after.content).toContain("Synthetic clearing transfer");
   expect(after.contentSha256).not.toBe(before.contentSha256);
  }finally{
   await prisma.businessSettings.update({where:{id:"singleton"},data:{exportPayoutLines:old.exportPayoutLines as never}});
   await prisma.journalLine.deleteMany({where:{entryId:payout.id}});
   await prisma.journalEntry.delete({where:{id:payout.id}});
  }
 });
 it("leaves old bytes immutable when account mappings change",async()=>{
  const batch=await prisma.exportBatch.findFirstOrThrow({where:{createdByUserId:owner,target:"QBO_JOURNAL_CSV"}});
  await prisma.accountExportMapping.update({where:{ledgerAccountId_target:{
   ledgerAccountId:bank,target:"QBO_JOURNAL_CSV",
  }},data:{externalName:"New banking name"}});
  const loaded=await readBookExport(owner,batch.id);
  expect(loaded.content).toBe(batch.content);
  expect(loaded.content).not.toContain("New banking name");
 });
});
