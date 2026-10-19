import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";

type Tx=Prisma.TransactionClient;
export type StatementInput={
 cashAccountId:string;from:string;through:string;beginningCents:number;endingCents:number;
 accountVersion:number;confirmedCompleteThrough:string;ownerConfirmedOpening:boolean;
 outstandingLineIds:string[];sourceReference:string;
};
const MAX_ROWS=10000;
const whole=(v:number,label:string)=>{
 if(!Number.isSafeInteger(v)||Math.abs(v)>1_000_000_000)
  throw new CashEvidenceError(label+" must be safe signed whole cents.");
 return v;
};
const date=(key:string)=>{
 const d=businessDateFromKey(key);
 if(!d||businessDateKey(d)!==key)throw new CashEvidenceError("Enter an actual Colorado statement date.");
 return d;
};
const nextDay=(key:string)=>{
 const d=new Date(key+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);
};
const cleanIds=(ids:string[])=>{
 if(ids.length>MAX_ROWS||ids.some(x=>typeof x!=="string"||!x||x.length>150)||ids.length!==new Set(ids).size)
  throw new CashEvidenceError("Opening outstanding source IDs must be unique and bounded.");
 return [...ids].sort();
};
const sum=(nums:number[])=>{
 const value=nums.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(value))throw new CashEvidenceError("Statement proof exceeds safe whole cents.");
 return value;
};
async function lockedAccount(tx:Tx,id:string){
 await tx.$queryRaw`SELECT "id" FROM "CashAccount" WHERE "id"=${id} FOR UPDATE`;
 const bank=await tx.cashAccount.findUnique({where:{id},include:{
  ledgerAccount:{select:{id:true,active:true,type:true,isPaymentSource:true}},
 }});
 if(!bank?.active||!bank.ledgerAccount.active||bank.currency!=="USD"||
    !bank.ledgerAccount.isPaymentSource||bank.ledgerAccount.type!=="ASSET")
  throw new CashEvidenceError("Register an active USD business bank source.");
 return bank;
}
function evidenceHash(obj:Record<string,unknown>){
 return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}
export async function getBankReconciliationHistory(userId:string,cashAccountId:string) {
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  await lockedAccount(tx,cashAccountId);
  return tx.bankReconciliation.findMany({where:{cashAccountId},orderBy:[
   {fromOn:"desc"},{revisionNo:"desc"}],take:100,
   select:{id:true,fromOn:true,toOn:true,beginningCents:true,endingCents:true,
    status:true,isCurrent:true,revisionNo:true,reopenReason:true,completedAt:true,includedEvidence:true},
  });
 });
}
export async function completeBankReconciliation(userId:string,input:StatementInput){
 const from=date(input.from),through=date(input.through),throughConfirmed=date(input.confirmedCompleteThrough);
 if(from>through||through.getTime()>Date.now()||throughConfirmed<through||
    !input.sourceReference?.trim()||input.sourceReference.trim().length>260)
  throw new CashEvidenceError("Confirm the statement range, full import-through day and real evidence reference.");
 whole(input.beginningCents,"Beginning balance");whole(input.endingCents,"Ending balance");
 const announced=cleanIds(input.outstandingLineIds);
 return prisma.$transaction(async tx=>{
  const actor=await assertActiveTeamActor(tx,userId,["OWNER"]);
  const account=await lockedAccount(tx,input.cashAccountId);
  if(account.version!==input.accountVersion)throw new CashEvidenceError("Bank source policy changed; refresh and re-attest.");
  const latest=await tx.bankReconciliation.findFirst({where:{
   cashAccountId:account.id,isCurrent:true,status:"COMPLETED",
  },orderBy:[{toOn:"desc"},{revisionNo:"desc"}]});
  if(latest){
   if(input.from!==nextDay(businessDateKey(latest.toOn))||input.beginningCents!==latest.endingCents)
    throw new CashEvidenceError("Statements must be consecutive with the previous completed ending balance.");
  }else{
   if(!input.ownerConfirmedOpening)
    throw new CashEvidenceError("Owner must attest the book opening and all pre-start outstanding journal items.");
   const priorLines=await tx.journalLine.findMany({where:{
    ledgerAccountId:account.ledgerAccountId,entry:{entryDate:{lt:from}},
    bankMatchItems:{none:{active:true}},
   },select:{id:true,debitCents:true,creditCents:true},take:MAX_ROWS+1});
   if(priorLines.length>MAX_ROWS)throw new CashEvidenceError("Too many prior book items; reconcile earlier periods first.");
   const actual=priorLines.map(x=>x.id).sort();
   if(JSON.stringify(actual)!==JSON.stringify(announced))
    throw new CashEvidenceError("Outstanding pre-statement book entries changed; review every source.");
   const bookTotal=await tx.journalLine.findMany({where:{
    ledgerAccountId:account.ledgerAccountId,entry:{entryDate:{lt:from}},
   },select:{debitCents:true,creditCents:true},take:MAX_ROWS+1});
   if(bookTotal.length>MAX_ROWS)throw new CashEvidenceError("Opening journal source window exceeds the review limit.");
   const book=sum(bookTotal.map(x=>x.debitCents-x.creditCents));
   const outstanding=sum(priorLines.map(x=>x.debitCents-x.creditCents));
   if(book-outstanding!==input.beginningCents)
    throw new CashEvidenceError("Attested bank beginning differs from book cash less explicitly outstanding entries.");
  }
  const conflict=await tx.bankReconciliation.findFirst({where:{
   cashAccountId:account.id,isCurrent:true,status:"COMPLETED",
   fromOn:{lte:through},toOn:{gte:from},
  }});
  if(conflict)throw new CashEvidenceError("Overlapping statement was completed; reopen it with a reason.");
  const observations=await tx.bankObservation.findMany({where:{
   cashAccountId:account.id,isActive:true,postedOn:{gte:from,lte:through},
  },include:{matchItems:{where:{active:true},include:{group:{include:{
   items:{where:{active:true},select:{journalLineId:true,signedCents:true}},
  }}}}},orderBy:{id:"asc"},take:MAX_ROWS+1});
  if(observations.length>MAX_ROWS)throw new CashEvidenceError("Too many imported rows; split the statement.");
  if(observations.some(o=>o.status!=="MATCHED"&&o.status!=="IGNORED"))
   throw new CashEvidenceError("Every imported observation must be matched or justified duplicate/non-account evidence.");
  if(observations.some(o=>o.status==="IGNORED" &&
   !/^(DUPLICATE|NON_ACCOUNT_ROW): \S/.test(o.ignoreReason??"")))
   throw new CashEvidenceError("Ignored evidence needs an approved duplicate/non-account reason.");
  const matched=observations.filter(o=>o.status==="MATCHED");
  if(matched.some(o=>o.matchItems.length!==1||o.matchItems[0]!.group.voidedAt!==null))
   throw new CashEvidenceError("A matched observation has no unique active non-voided source group.");
  const matchedIds=[...new Set(matched.map(o=>o.matchItems[0]!.groupId))].sort();
  const groups=await tx.bankMatchGroup.findMany({where:{id:{in:matchedIds}},
   include:{items:{where:{active:true},include:{
    observation:{select:{id:true,cashAccountId:true,postedOn:true,signedCents:true}},
    journalLine:{select:{id:true,ledgerAccountId:true,debitCents:true,creditCents:true}},
   }}}});
  const lineIds=new Set<string>();
  for(const group of groups){
   const obs=group.items.filter(i=>i.bankObservationId),lines=group.items.filter(i=>i.journalLineId);
   if(!obs.length||!lines.length||group.cashAccountId!==account.id||group.voidedAt)
    throw new CashEvidenceError("Matched grouping is incomplete or voided.");
   const obAmount=sum(obs.map(i=>i.signedCents)),lineAmount=sum(lines.map(i=>i.signedCents));
   if(obAmount!==lineAmount||
     lines.some(i=>!i.journalLine||i.journalLine.ledgerAccountId!==account.ledgerAccountId||
       i.signedCents!==i.journalLine.debitCents-i.journalLine.creditCents))
    throw new CashEvidenceError("Source journal does not equal observed bank movement.");
   for(const item of lines)lineIds.add(item.journalLineId!);
  }
  const bankNet=sum(matched.map(o=>o.signedCents));
  const lineNet=sum(groups.flatMap(g=>g.items.filter(i=>i.journalLineId)
    .filter(i=>!lineIds.has("__none__")).map(i=>i.signedCents)));
  if(bankNet!==lineNet)
   throw new CashEvidenceError("Bank observations and matched source journal lines differ.");
  if(input.beginningCents+bankNet!==input.endingCents)
   throw new CashEvidenceError("Statement difference is not zero cents; no balancing plug is allowed.");
  // A reopened earlier statement must be re-completed using an explicit new
  // version; do not overwrite the prior completed snapshot.
  const previous=await tx.bankReconciliation.findFirst({where:{
   cashAccountId:account.id,fromOn:from,toOn:through,
  },orderBy:{revisionNo:"desc"}});
  if(previous?.isCurrent&&previous.status==="COMPLETED")
   throw new CashEvidenceError("A completed statement cannot be silently replaced.");
  const evidence={
   schemaVersion:1,accountId:account.id,ledgerAccountId:account.ledgerAccountId,
   from:input.from,through:input.through,confirmedCompleteThrough:input.confirmedCompleteThrough,
   beginningCents:input.beginningCents,endingCents:input.endingCents,bankNet,
   matchedObservationIds:matched.map(x=>x.id).sort(),
   ignoredObservationIds:observations.filter(x=>x.status==="IGNORED").map(x=>x.id).sort(),
   matchGroupIds:matchedIds,matchedJournalLineIds:[...lineIds].sort(),
   openingOutstandingLineIds:announced,
   sourceReference:input.sourceReference.trim(),attestedBy:actor.id,
  };
  const hashed={...evidence,sha256:evidenceHash(evidence)};
  const row=await tx.bankReconciliation.create({data:{
   cashAccountId:account.id,fromOn:from,toOn:through,
   beginningCents:input.beginningCents,endingCents:input.endingCents,
   status:"COMPLETED",revisionNo:(previous?.revisionNo??0)+1,isCurrent:true,
   priorCompletedId:previous?.id??null,includedEvidence:hashed,
   completedAt:new Date(),completedByUserId:userId,
  }});
  await tx.auditLog.create({data:{userId,action:"books.cash.statement.complete",
   entityType:"BankReconciliation",entityId:row.id,newValue:{
    from:input.from,to:input.through,evidenceHash:hashed.sha256,
    bankNet,matchedCount:matched.length,ignoredCount:observations.length-matched.length,
   }}});
  return {id:row.id,sha256:hashed.sha256,bankNet};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function reopenBankReconciliation(userId:string,id:string,expectedVersion:number,reason:string){
 const why=reason?.trim();
 if(!why||why.length>300)throw new CashEvidenceError("Explain why bank evidence must be reopened.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const pre=await tx.bankReconciliation.findUnique({where:{id},select:{cashAccountId:true}});
  if(!pre)throw new CashEvidenceError("Statement evidence not found.");
  await lockedAccount(tx,pre.cashAccountId);
  const row=await tx.bankReconciliation.findUniqueOrThrow({where:{id}});
  if(!row.isCurrent||row.status!=="COMPLETED"||row.version!==expectedVersion)
   throw new CashEvidenceError("Only a current, unchanged completed statement can be reopened.");
  const affected=await tx.bankReconciliation.findMany({where:{
   cashAccountId:row.cashAccountId,isCurrent:true,status:"COMPLETED",
   fromOn:{gte:row.fromOn},
  },orderBy:{fromOn:"asc"}});
  if(!affected.some(x=>x.id===row.id))
   throw new CashEvidenceError("Statement history changed; refresh.");
  await tx.bankReconciliation.updateMany({where:{id:{in:affected.map(x=>x.id)}},data:{
   status:"REOPENED",isCurrent:false,reopenReason:why,version:{increment:1},
  }});
  await tx.auditLog.create({data:{userId,action:"books.cash.statement.reopen",
   entityType:"BankReconciliation",entityId:id,newValue:{
    reason:why,invalidatedIds:affected.map(x=>x.id),
   }}});
  return {invalidated:affected.length};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
