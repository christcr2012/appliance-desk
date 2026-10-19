import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey, businessDateFromKey } from "@/lib/business-date";
import { postForSource } from "@/domains/books/post";
import { cashEventPlan, CASH_EVENT_KINDS, type CashEventKind } from "./event-plan";
import { CashEvidenceError } from "./accounts";

export type CashEventInput={
 kind:CashEventKind;amountCents:number;occurredDate:string;
 fromLedgerAccountId?:string|null;toLedgerAccountId?:string|null;
 sourceReceiptIds?:string[];memo:string;
};
const date=(key:string)=>{
 const d=businessDateFromKey(key);
 if(!d||businessDateKey(d)!==key||d.getTime()>Date.now())throw new CashEvidenceError("Enter an actual past or current Colorado transaction date.");
 return d;
};
const safeKey=(s:string)=>{
 if(!/^[A-Za-z0-9_-]{10,120}$/.test(s))throw new CashEvidenceError("An opaque command key is required for safe retries.");
 return s;
};
const amount=(v:number)=>{if(!Number.isSafeInteger(v)||v<=0||v>1_000_000_000)throw new CashEvidenceError("Amount must be positive whole cents.");return v;};
function normalized(e:CashEventInput){
 if(!CASH_EVENT_KINDS.includes(e.kind))throw new CashEvidenceError("Unsupported cash source.");
 const amt=amount(e.amountCents),d=date(e.occurredDate),memo=e.memo.trim();
 if(!memo||memo.length>300)throw new CashEvidenceError("Provide a source explanation within 300 characters.");
 const ids=e.sourceReceiptIds??[];
 if(ids.length>500||new Set(ids).size!==ids.length||ids.some(x=>!/^[A-Za-z0-9_-]{4,150}$/.test(x)))
  throw new CashEvidenceError("Receipt identities must be valid, unique, and bounded.");
 if(e.kind!=="CASH_DEPOSIT"&&ids.length)throw new CashEvidenceError("Only a cash/check deposit links receipts.");
 if(e.kind==="CASH_DEPOSIT"&&!ids.length)throw new CashEvidenceError("A cash/check deposit needs source receipt IDs.");
 return {kind:e.kind,amountCents:amt,occurredOn:d,memo,fromLedgerAccountId:e.fromLedgerAccountId??null,
  toLedgerAccountId:e.toLedgerAccountId??null,sourceReceiptIds:{schemaVersion:1,ids:ids.slice().sort()}};
}
async function requireBank(tx:Prisma.TransactionClient,ledgerId:string|null){
 if(!ledgerId)return;
 await tx.$queryRaw`SELECT "id" FROM "CashAccount" WHERE "ledgerAccountId"=${ledgerId} FOR UPDATE`;
 const bank=await tx.cashAccount.findUnique({where:{ledgerAccountId:ledgerId},
  include:{ledgerAccount:{select:{active:true,isPaymentSource:true,type:true}}}});
 if(!bank?.active||bank.currency!=="USD"||!bank.ledgerAccount.active||
   !bank.ledgerAccount.isPaymentSource||bank.ledgerAccount.type!=="ASSET")
  throw new CashEvidenceError("Select an active registered business-bank source.");
}
export async function recordBookCashEvent(userId:string,commandKey:string,input:CashEventInput){
 const cmd=safeKey(commandKey),n=normalized(input);
 cashEventPlan({...n,reversalOfId:null});
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  // Distinct command idempotency; no double-submit, including parallel requests.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash-command:"+cmd}))`;
  const old=await tx.bookCashEvent.findUnique({where:{commandKey:cmd}});
  const equal=old&&old.kind===n.kind&&old.amountCents===n.amountCents&&
    old.occurredOn.getTime()===n.occurredOn.getTime()&&old.memo===n.memo&&
    old.fromLedgerAccountId===n.fromLedgerAccountId&&old.toLedgerAccountId===n.toLedgerAccountId&&
    JSON.stringify(old.sourceReceiptIds)===JSON.stringify(n.sourceReceiptIds);
  if(old){
   if(!equal)throw new CashEvidenceError("This command was already used for a different cash event.");
   return old.id;
  }
  const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}});
  if(!settings?.booksStartDate||n.occurredOn<settings.booksStartDate)
   throw new CashEvidenceError("Initialize verified Books opening balances before recording cash activity.");
  await requireBank(tx,n.fromLedgerAccountId);
  if(n.toLedgerAccountId!==n.fromLedgerAccountId)await requireBank(tx,n.toLedgerAccountId);
  if(n.kind==="CASH_DEPOSIT"){
   const ids=n.sourceReceiptIds.ids;
   const rows=await tx.receipt.findMany({where:{id:{in:ids}},select:{
    id:true,source:true,method:true,amountCents:true,receivedOn:true,
   }});
   if(rows.length!==ids.length||rows.some(r=>r.source!=="MANUAL"||
     !["CASH","CHECK"].includes(r.method.toUpperCase())||r.receivedOn>n.occurredOn))
    throw new CashEvidenceError("Deposit requires settled cash/check receipts with dates on or before the deposit.");
   const total=rows.reduce((sum,r)=>sum+r.amountCents,0);
   if(!Number.isSafeInteger(total)||total!==n.amountCents)
    throw new CashEvidenceError("Cash deposit must exactly equal the linked receipts.");
   // Serialize deposit allocations, even across differing command keys.
   for(const id of ids)await tx.$queryRaw`SELECT "id" FROM "Receipt" WHERE "id"=${id} FOR UPDATE`;
   const past=await tx.bookCashEvent.findMany({where:{kind:"CASH_DEPOSIT",status:"POSTED"},
    select:{sourceReceiptIds:true},take:10000});
   for(const prior of past)if(prior.sourceReceiptIds&&typeof prior.sourceReceiptIds==="object"&&
     !Array.isArray(prior.sourceReceiptIds)&&Array.isArray(prior.sourceReceiptIds.ids)&&
     prior.sourceReceiptIds.ids.some(id=>typeof id==="string"&&ids.includes(id)))
    throw new CashEvidenceError("One of these cash/check receipts was already deposited.");
  }
  const result=await tx.bookCashEvent.create({data:{
   commandKey:cmd,kind:n.kind,amountCents:n.amountCents,occurredOn:n.occurredOn,
   fromLedgerAccountId:n.fromLedgerAccountId,toLedgerAccountId:n.toLedgerAccountId,
   sourceReceiptIds:n.sourceReceiptIds,memo:n.memo,createdByUserId:userId,
  }});
  await postForSource(tx,"CASH_EVENT",result.id);
  const journal=await tx.journalEntry.findUnique({where:{sourceType_sourceId_eventKind:{
   sourceType:"CASH_EVENT",sourceId:result.id,eventKind:"CASH_EVENT_POSTED",
  }},select:{id:true}});
  if(!journal)throw new CashEvidenceError("A balanced cash journal was not posted; no source was saved.");
  await tx.auditLog.create({data:{userId,action:"books.cash.event.post",entityType:"BookCashEvent",
   entityId:result.id,newValue:{kind:n.kind,amountCents:n.amountCents,occurredDate:input.occurredDate,
    sourceReceiptIds:n.sourceReceiptIds.ids}}});
  return result.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function voidBookCashEvent(userId:string,sourceId:string,expectedVersion:number,commandKey:string,reason:string){
 const cmd=safeKey(commandKey),why=reason.trim();
 if(!why||why.length>250)throw new CashEvidenceError("A reason is required to reverse recorded cash.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BookCashEvent" WHERE "id"=${sourceId} FOR UPDATE`;
  const row=await tx.bookCashEvent.findUnique({where:{id:sourceId}});
  if(!row||row.reversalOfId||row.status!=="POSTED"||row.version!==expectedVersion)
   throw new CashEvidenceError("This cash event changed or was already reversed.");
  const old=await tx.journalEntry.findUnique({where:{sourceType_sourceId_eventKind:{
   sourceType:"CASH_EVENT",sourceId,eventKind:"CASH_EVENT_POSTED",
  }},select:{id:true}});
  if(!old)throw new CashEvidenceError("Original source-backed cash journal is missing.");
  const reversal=await tx.bookCashEvent.create({data:{
   commandKey:cmd,kind:row.kind,amountCents:row.amountCents,occurredOn:new Date(),
   fromLedgerAccountId:row.fromLedgerAccountId,toLedgerAccountId:row.toLedgerAccountId,
   sourceReceiptIds:row.sourceReceiptIds??Prisma.JsonNull,memo:why,createdByUserId:userId,
   reversalOfId:sourceId,
  }});
  await postForSource(tx,"CASH_EVENT",reversal.id);
  const posting=await tx.journalEntry.findUnique({where:{sourceType_sourceId_eventKind:{
   sourceType:"CASH_EVENT",sourceId:reversal.id,eventKind:"CASH_EVENT_REVERSED",
  }},select:{id:true}});
  if(!posting)throw new CashEvidenceError("Cash reversal cannot be journaled.");
  await tx.bookCashEvent.update({where:{id:sourceId},data:{status:"VOID",version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.cash.event.void",
   entityType:"BookCashEvent",entityId:sourceId,newValue:{reason:why,reversalId:reversal.id}}});
  return reversal.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
