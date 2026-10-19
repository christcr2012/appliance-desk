import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {prisma} from "@/lib/prisma";
import {recordBookCashEvent,voidBookCashEvent} from "@/domains/books/cash/events";
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,10),owner="cash-event-owner-"+tag,staff="cash-event-staff-"+tag;
const b1="cash-event-1-"+tag,b2="cash-event-2-"+tag;
let savedStart:Date|null=null;
const sourceIds:string[]=[];
const base=(over:Record<string,unknown>={})=>({
 kind:"BANK_TRANSFER" as const,amountCents:375,occurredDate:"2026-10-16",
 fromLedgerAccountId:b1,toLedgerAccountId:b2,memo:"Synthetic transfer",...over,
});
describe.skipIf(!enabled)("K-CASH-2 real-Postgres typed cash sources and immutable reversal",()=>{
 beforeAll(async()=>{
  savedStart=(await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}})).booksStartDate;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:new Date("2026-01-01T07:00:00Z")}});
  await prisma.user.createMany({data:[{id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:staff,email:staff+"@example.test",role:"STAFF"}]});
  await prisma.ledgerAccount.createMany({data:[{id:b1,name:"K cash bank A "+tag,type:"ASSET",
   description:"Synthetic A",isPaymentSource:true},
   {id:b2,name:"K cash bank B "+tag,type:"ASSET",description:"Synthetic B",isPaymentSource:true}]});
  await prisma.cashAccount.createMany({data:[{ledgerAccountId:b1,name:"Synthetic A",institutionLabel:"Fixture"},
   {ledgerAccountId:b2,name:"Synthetic B",institutionLabel:"Fixture"}]});
 });
 afterAll(async()=>{
  const eventIds=(await prisma.bookCashEvent.findMany({where:{createdByUserId:owner},select:{id:true}})).map(x=>x.id);
  await prisma.journalLine.deleteMany({where:{entry:{sourceType:"CASH_EVENT",sourceId:{in:eventIds}}}});
  await prisma.journalEntry.deleteMany({where:{sourceType:"CASH_EVENT",sourceId:{in:eventIds}}});
  for(const id of eventIds.reverse()){
   const reversed=await prisma.bookCashEvent.findUnique({where:{id},select:{reversalOfId:true}});
   if(reversed?.reversalOfId)await prisma.bookCashEvent.delete({where:{id}});
  }
  await prisma.bookCashEvent.deleteMany({where:{createdByUserId:owner}});
  await prisma.auditLog.deleteMany({where:{userId:owner}});
  await prisma.cashAccount.deleteMany({where:{ledgerAccountId:{in:[b1,b2]}}});
  await prisma.ledgerAccount.deleteMany({where:{id:{in:[b1,b2]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:savedStart}});
  await prisma.user.deleteMany({where:{id:{in:[owner,staff]}}});
 });
 it("rejects staff, bad accounts, unapproved no-source money and zero cents",async()=>{
  await expect(recordBookCashEvent(staff,"staff-"+tag,base())).rejects.toThrow(/access/);
  await expect(recordBookCashEvent(owner,"zero-amount-"+tag,base({amountCents:0}))).rejects.toThrow(/positive/);
  await expect(recordBookCashEvent(owner,"same-bank-"+tag,base({toLedgerAccountId:b1}))).rejects.toThrow(/distinct/);
  await expect(recordBookCashEvent(owner,"foreign-bank-"+tag,base({toLedgerAccountId:"invalid-other-ledger"}))).rejects.toThrow(/active registered/);
  expect(await prisma.bookCashEvent.count({where:{createdByUserId:owner}})).toBe(0);
 });
 it("posts exactly one balanced bank-to-bank journal despite command retry and double submit",async()=>{
  const cmd="transfer-"+tag;
  const results=await Promise.allSettled([recordBookCashEvent(owner,cmd,base()),recordBookCashEvent(owner,cmd,base())]);
  expect(results.some(x=>x.status==="fulfilled")).toBe(true);
  const events=await prisma.bookCashEvent.findMany({where:{commandKey:cmd}});
  expect(events).toHaveLength(1);
  sourceIds.push(events[0]!.id);
  const lines=await prisma.journalLine.findMany({where:{entry:{sourceType:"CASH_EVENT",sourceId:events[0]!.id}},
   include:{ledgerAccount:true}});
  expect(lines.reduce((sum,l)=>sum+l.debitCents-l.creditCents,0)).toBe(0);
  expect(lines.find(l=>l.ledgerAccountId===b1)?.creditCents).toBe(375);
  expect(lines.find(l=>l.ledgerAccountId===b2)?.debitCents).toBe(375);
  expect(await prisma.journalEntry.count({where:{sourceType:"CASH_EVENT",sourceId:events[0]!.id}})).toBe(1);
  await expect(recordBookCashEvent(owner,cmd,base({amountCents:376}))).rejects.toThrow(/different cash event/);
 });
 it("creates exactly one explicit inverse journal and refuses repeated/stale reversals",async()=>{
  const id=sourceIds[0]!;
  const reversal=await voidBookCashEvent(owner,id,1,"reverse-"+tag,"Verified duplicate source");
  const rows=await prisma.journalEntry.findMany({where:{sourceType:"CASH_EVENT",sourceId:{in:[id,reversal]}},
   include:{lines:true}});
  expect(rows).toHaveLength(2);
  expect(rows.map(x=>x.eventKind).sort()).toEqual(["CASH_EVENT_POSTED","CASH_EVENT_REVERSED"]);
  const net=rows.flatMap(r=>r.lines).reduce((sum,l)=>sum+l.debitCents-l.creditCents,0);
  expect(net).toBe(0);
  expect((await prisma.bookCashEvent.findUniqueOrThrow({where:{id}})).status).toBe("VOID");
  await expect(voidBookCashEvent(owner,id,1,"repeat-"+tag,"Retry")).rejects.toThrow(/already reversed|changed/);
 });
 it("retains distinct source identities across multiple financial kinds",async()=>{
  for(const [kind,from,to] of [
   ["OWNER_CONTRIBUTION",null,b1],["OWNER_DRAW",b1,null],
   ["BANK_INTEREST",null,b1],["CARD_PAYMENT",b1,null],
  ] as const){
   const id=await recordBookCashEvent(owner,"kind-"+kind+"-"+tag,{kind,fromLedgerAccountId:from,
    toLedgerAccountId:to,amountCents:100,occurredDate:"2026-10-16",memo:"Synthetic "+kind});
   const lines=await prisma.journalLine.findMany({where:{entry:{sourceType:"CASH_EVENT",sourceId:id}}});
   expect(lines.reduce((sum,l)=>sum+l.debitCents-l.creditCents,0)).toBe(0);
  }
 });
});
