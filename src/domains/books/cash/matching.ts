import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";

type Tx = Prisma.TransactionClient;
export type CashMatchSelection={accountId:string;key:string;observationIds:string[];journalLineIds:string[]};
const uniq=(ids:string[],label:string)=>{
 if(!ids.length||ids.length>100||ids.some(id=>!id||id.length>150)||new Set(ids).size!==ids.length)
  throw new CashEvidenceError("Choose distinct, bounded "+label+" items.");
 return [...ids].sort();
};
const signed=(n:number)=>{if(!Number.isSafeInteger(n)||n===0)throw new CashEvidenceError("Invalid signed cash amount.");return n;};
const daysApart=(a:Date,b:Date)=>{
 const toDay=(d:Date)=>Date.parse(businessDateKey(d)+"T00:00:00Z");
 return Math.abs((toDay(a)-toDay(b))/86400000);
};
async function lockBank(tx:Tx,id:string) {
 await tx.$queryRaw`SELECT "id" FROM "CashAccount" WHERE "id"=${id} FOR UPDATE`;
 const bank=await tx.cashAccount.findUnique({where:{id},include:{ledgerAccount:{select:{active:true}}}});
 if(!bank?.active||!bank.ledgerAccount.active||bank.currency!=="USD")
  throw new CashEvidenceError("Choose an active registered business bank account.");
 return bank;
}
async function lockIds(tx:Tx,table:"BankObservation"|"JournalLine",ids:string[]){
 for(const id of ids) {
  if(table==="BankObservation")await tx.$queryRaw`SELECT "id" FROM "BankObservation" WHERE "id"=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "JournalLine" WHERE "id"=${id} FOR UPDATE`;
 }
}
export function assertSameCashSide(observations:{signedCents:number;postedOn:Date}[],
 lines:{debitCents:number;creditCents:number;entry:{entryDate:Date}}[],windowDays:number){
 if(!observations.length||!lines.length||!Number.isSafeInteger(windowDays)||windowDays<0||windowDays>30)
  throw new CashEvidenceError("Select bank and journal entries with a configured match window.");
 const a=observations.map(o=>signed(o.signedCents));
 const b=lines.map(l=>signed(l.debitCents-l.creditCents));
 const sign=Math.sign(a[0]!);
 if([...a,...b].some(v=>Math.sign(v)!==sign))
  throw new CashEvidenceError("Do not net opposite-direction money or mixed signs.");
 const sum=(v:number[])=>v.reduce((n,x)=>n+x,0);
 if(!Number.isSafeInteger(sum(a))||sum(a)!==sum(b))
  throw new CashEvidenceError("Bank evidence and booked bank lines must total exactly the same cents.");
 if(observations.some(o=>!lines.some(l=>daysApart(o.postedOn,l.entry.entryDate)<=windowDays))||
    lines.some(l=>!observations.some(o=>daysApart(o.postedOn,l.entry.entryDate)<=windowDays)))
  throw new CashEvidenceError("Bank and journal dates exceed the account match window.");
 return sum(a);
}
/** Suggestions use stored match policy and never claim or post a journal line. */
export async function getBankMatchCandidates(userId:string,accountId:string) {
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const bank=await lockBank(tx,accountId);
  const observations=await tx.bankObservation.findMany({where:{
   cashAccountId:accountId,isActive:true,status:"UNMATCHED",
   matchItems:{none:{active:true}},
  },orderBy:[{postedOn:"desc"},{id:"asc"}],take:80,
   select:{id:true,postedOn:true,signedCents:true,version:true,description:true}});
  const lines=await tx.journalLine.findMany({where:{ledgerAccountId:bank.ledgerAccountId,
   bankMatchItems:{none:{active:true}},
  },orderBy:[{entry:{entryDate:"desc"}},{id:"asc"}],take:500,
   select:{id:true,debitCents:true,creditCents:true,entry:{select:{
    entryNumber:true,entryDate:true,sourceType:true,eventKind:true,memo:true,
   }}}});
  const results=observations.map(o=>({
   ...o,suggestions:lines.filter(l=>l.debitCents-l.creditCents===o.signedCents &&
    daysApart(o.postedOn,l.entry.entryDate)<=bank.bankMatchWindowDays).slice(0,12).map(l=>l.id),
  }));
  return {bank:{id:bank.id,name:bank.name,bankMatchWindowDays:bank.bankMatchWindowDays,
    ledgerAccountId:bank.ledgerAccountId},observations:results,lines};
 });
}
export async function confirmBankMatch(userId:string,selection:CashMatchSelection){
 const obsIds=uniq(selection.observationIds,"bank"),lineIds=uniq(selection.journalLineIds,"journal");
 if(!/^[A-Za-z0-9_-]{10,120}$/.test(selection.key))
  throw new CashEvidenceError("An opaque match command key is required for safe retries.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const bank=await lockBank(tx,selection.accountId);
  const existing=await tx.bankMatchGroup.findUnique({where:{key:selection.key},include:{items:true}});
  if(existing) {
   const priorObs=existing.items.filter(i=>i.bankObservationId).map(i=>i.bankObservationId!).sort();
   const priorLines=existing.items.filter(i=>i.journalLineId).map(i=>i.journalLineId!).sort();
   if(existing.cashAccountId===bank.id && !existing.voidedAt &&
     JSON.stringify(priorObs)===JSON.stringify(obsIds)&&JSON.stringify(priorLines)===JSON.stringify(lineIds))
    return existing.id;
   throw new CashEvidenceError("This match command already refers to different or voided evidence.");
  }
  await lockIds(tx,"BankObservation",obsIds);
  await lockIds(tx,"JournalLine",lineIds);
  const [observations,lines]=await Promise.all([
   tx.bankObservation.findMany({where:{id:{in:obsIds}},include:{matchItems:{where:{active:true}}}}),
   tx.journalLine.findMany({where:{id:{in:lineIds}},
    include:{entry:{select:{entryDate:true,entryNumber:true}},
      bankMatchItems:{where:{active:true}}}}),
  ]);
  if(observations.length!==obsIds.length||lines.length!==lineIds.length||
    observations.some(o=>o.cashAccountId!==bank.id||!o.isActive||o.status!=="UNMATCHED"||
      o.matchItems.length>0)||lines.some(l=>l.ledgerAccountId!==bank.ledgerAccountId||
      l.bankMatchItems.length>0))
   throw new CashEvidenceError("Some selected evidence was used, superseded, or belongs to another bank.");
  assertSameCashSide(observations,lines,bank.bankMatchWindowDays);
  const amounts=[
   ...observations.map(o=>({bankObservationId:o.id,signedCents:o.signedCents})),
   ...lines.map(l=>({journalLineId:l.id,signedCents:l.debitCents-l.creditCents})),
  ];
  const group=await tx.bankMatchGroup.create({data:{
   cashAccountId:bank.id,key:selection.key,createdByUserId:userId,
   items:{create:amounts},
  }});
  await tx.bankObservation.updateMany({where:{id:{in:obsIds},cashAccountId:bank.id},
   data:{status:"MATCHED",version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.cash.match.confirm",entityType:"BankMatchGroup",
   entityId:group.id,newValue:{accountId:bank.id,observationIds:obsIds,journalLineIds:lineIds}}});
  return group.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:25000});
}
export async function voidBankMatch(userId:string,id:string,expectedVersion:number,reason:string){
 const why=reason?.trim();
 if(!why||why.length>300)throw new CashEvidenceError("Enter a specific match reversal reason.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const groupRead=await tx.bankMatchGroup.findUnique({where:{id},select:{cashAccountId:true}});
  if(!groupRead)throw new CashEvidenceError("Match group cannot be found.");
  await lockBank(tx,groupRead.cashAccountId);
  await tx.$queryRaw`SELECT "id" FROM "BankMatchGroup" WHERE "id"=${id} FOR UPDATE`;
  const group=await tx.bankMatchGroup.findUniqueOrThrow({where:{id},include:{
   items:{where:{active:true},include:{observation:{select:{postedOn:true}}}},
  }});
  if(group.voidedAt||group.version!==expectedVersion)
   throw new CashEvidenceError("Match changed or is already voided; refresh.");
  const obs=group.items.filter(i=>i.bankObservationId);
  if(!obs.length)throw new CashEvidenceError("Match lacks bank source evidence.");
  const [first,last]=[obs.reduce((d,i)=>i.observation!.postedOn<d?i.observation!.postedOn:d,obs[0]!.observation!.postedOn),
   obs.reduce((d,i)=>i.observation!.postedOn>d?i.observation!.postedOn:d,obs[0]!.observation!.postedOn)];
  const protectedPeriod=await tx.bankReconciliation.findFirst({where:{
   cashAccountId:group.cashAccountId,status:"COMPLETED",isCurrent:true,
   fromOn:{lte:last},toOn:{gte:first},
  },select:{id:true}});
  if(protectedPeriod)throw new CashEvidenceError("Reopen the completed bank reconciliation before changing a match.");
  const obsIds=obs.map(i=>i.bankObservationId!).sort();
  await lockIds(tx,"BankObservation",obsIds);
  await tx.bankMatchItem.updateMany({where:{groupId:id,active:true},data:{active:false}});
  await tx.bankObservation.updateMany({where:{id:{in:obsIds},isActive:true},
   data:{status:"UNMATCHED",version:{increment:1}}});
  await tx.bankMatchGroup.update({where:{id},data:{
   voidedAt:new Date(),voidedByUserId:userId,voidedReason:why,version:{increment:1},
  }});
  await tx.auditLog.create({data:{userId,action:"books.cash.match.void",entityType:"BankMatchGroup",
   entityId:id,newValue:{reason:why,observationIds:obsIds}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function ignoreBankObservation(userId:string,id:string,expectedVersion:number,
 kind:"DUPLICATE"|"NON_ACCOUNT_ROW",reason:string){
 const why=reason?.trim();
 if(!["DUPLICATE","NON_ACCOUNT_ROW"].includes(kind)||!why||why.length>300)
  throw new CashEvidenceError("Only verified duplicate/non-account rows can be ignored with a reason.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const pre=await tx.bankObservation.findUnique({where:{id},select:{cashAccountId:true}});
  if(!pre)throw new CashEvidenceError("Bank row not found.");
  await lockBank(tx,pre.cashAccountId);
  await lockIds(tx,"BankObservation",[id]);
  const row=await tx.bankObservation.findUniqueOrThrow({where:{id},include:{
   matchItems:{where:{active:true}},
  }});
  if(row.version!==expectedVersion||row.status!=="UNMATCHED"||!row.isActive||row.matchItems.length)
   throw new CashEvidenceError("This bank row changed or was already matched.");
  if(await tx.bankReconciliation.findFirst({where:{cashAccountId:row.cashAccountId,
   status:"COMPLETED",isCurrent:true,fromOn:{lte:row.postedOn},toOn:{gte:row.postedOn}},select:{id:true}}))
   throw new CashEvidenceError("Reopen the completed period before changing bank evidence.");
  if(kind==="DUPLICATE"){
   const sibling=await tx.bankObservation.findFirst({where:{
    cashAccountId:row.cashAccountId,id:{not:id},isActive:true,
    fingerprint:row.fingerprint,occurrenceIndex:row.occurrenceIndex,
   },select:{id:true}});
   if(!sibling)throw new CashEvidenceError("Duplicate bank row has no independent matching source.");
  }
  await tx.bankObservation.update({where:{id},data:{
   status:"IGNORED",ignoreReason:kind+": "+why,version:{increment:1},
  }});
  await tx.auditLog.create({data:{userId,action:"books.cash.observation.ignore",
   entityType:"BankObservation",entityId:id,newValue:{kind,reason:why}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
