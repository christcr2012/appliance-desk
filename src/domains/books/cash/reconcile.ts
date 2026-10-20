import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey, addBusinessDays } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";

type Tx=Prisma.TransactionClient;
const MAX=20000;
const cents=(n:number)=>Number.isSafeInteger(n)&&Math.abs(n)<=2_000_000_000;
function validDate(key:string){
 const date=businessDateFromKey(key);
 if(!date||businessDateKey(date)!==key||date.getTime()>Date.now())
  throw new CashEvidenceError("Choose an actual, nonfuture Colorado statement date.");
 return date;
}
async function lockBank(tx:Tx,id:string){
 await tx.$queryRawUnsafe('SELECT "id" FROM "CashAccount" WHERE "id"=$1 FOR UPDATE',id);
 const bank=await tx.cashAccount.findUnique({where:{id}});
 if(!bank?.active||bank.currency!=="USD")throw new CashEvidenceError("Active registered business bank required.");
 return bank;
}
async function currentStatements(tx:Tx,accountId:string){
 return tx.bankReconciliation.findMany({where:{cashAccountId:accountId,isCurrent:true},
  orderBy:[{fromOn:"asc"},{revisionNo:"asc"}]});
}
const signed=(l:{debitCents:number;creditCents:number})=>l.debitCents-l.creditCents;
export type FirstStatementProof={
 bookBeginningCents:number;preStartOutstandingCents:number;sourceReference:string;
};
export type NewStatement={
 accountId:string;fromDate:string;toDate:string;beginningCents:number;endingCents:number;
 firstStatement?:FirstStatementProof;
};
/** Drafts are unverified; explicit attestation never produces spendable cash on its own. */
export async function createBankReconciliation(userId:string,input:NewStatement){
 const from=validDate(input.fromDate),to=validDate(input.toDate);
 if(from>to||![input.beginningCents,input.endingCents].every(cents))
  throw new CashEvidenceError("Invalid period or statement amounts.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const bank=await lockBank(tx,input.accountId);
  const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},
   select:{booksStartDate:true}});
  if(!settings?.booksStartDate||from<settings.booksStartDate)
   throw new CashEvidenceError("Initialize books and choose a statement after the book start date.");
  const all=await currentStatements(tx,bank.id);
  if(all.some(s=>s.status!=="COMPLETED")||all.some(s=>s.fromOn<=to&&s.toOn>=from))
   throw new CashEvidenceError("Finish/reopen the existing statement before adding an overlapping or pending statement.");
  const last=all.at(-1);
  if(last){
   if(last.status!=="COMPLETED"||from.getTime()!==addBusinessDays(last.toOn,1).getTime()||
      input.beginningCents!==last.endingCents)
    throw new CashEvidenceError("Statements must begin the day after the last completed ending balance.");
  }else{
   const proof=input.firstStatement,ref=proof?.sourceReference.trim()??"";
   if(!proof||!cents(proof.bookBeginningCents)||!cents(proof.preStartOutstandingCents)||
      !ref||ref.length>250||proof.bookBeginningCents+proof.preStartOutstandingCents!==input.beginningCents)
    throw new CashEvidenceError("First statement needs independently checked Books opening, outstanding composition and a source reference.");
   const prior=await tx.journalLine.findMany({where:{
    ledgerAccountId:bank.ledgerAccountId,entry:{entryDate:{lt:from}}},
    select:{debitCents:true,creditCents:true},take:MAX+1});
   if(prior.length>MAX||prior.reduce((s,l)=>s+signed(l),0)!==proof.bookBeginningCents)
    throw new CashEvidenceError("First statement book beginning does not tie to the ledger; review opening composition.");
  }
  const draft=await tx.bankReconciliation.create({data:{
   cashAccountId:bank.id,fromOn:from,toOn:to,beginningCents:input.beginningCents,
   endingCents:input.endingCents,includedEvidence:input.firstStatement?{
    stage:"DRAFT",firstStatement:{bookBeginningCents:input.firstStatement.bookBeginningCents,
     preStartOutstandingCents:input.firstStatement.preStartOutstandingCents,
     sourceReference:input.firstStatement.sourceReference.trim()}}:Prisma.JsonNull
  }});
  await tx.auditLog.create({data:{userId,action:"books.bank.statement.draft",
   entityType:"BankReconciliation",entityId:draft.id,newValue:{
    accountId:bank.id,fromDate:input.fromDate,toDate:input.toDate,
    beginningCents:input.beginningCents,endingCents:input.endingCents,
    ownerAttestedOpening:Boolean(input.firstStatement)}}});
  return draft.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
type ReconciliationEvidence={
 schemaVersion:1;from:string;to:string;beginningCents:number;endingCents:number;
 observations:Array<{id:string;date:string;signedCents:number;status:string;ignoreReason:string|null;groupId:string|null}>;
 lines:Array<{id:string;entryDate:string;signedCents:number;groupId:string}>;
 outstanding:Array<{id:string;entryDate:string;signedCents:number}>;
 observationSumCents:number;journalMatchedSumCents:number;bankDifferenceCents:number;
 sourceHash:string;firstStatement:unknown;
};
async function evidence(tx:Tx,bank:{id:string;ledgerAccountId:string},
 statement:{fromOn:Date;toOn:Date;beginningCents:number;endingCents:number;includedEvidence:Prisma.JsonValue|null}){
 const obs=await tx.bankObservation.findMany({where:{cashAccountId:bank.id,isActive:true,
   postedOn:{gte:statement.fromOn,lte:statement.toOn}},include:{matchItems:{where:{active:true},
     include:{group:{select:{id:true,voidedAt:true}}}}},orderBy:[{postedOn:"asc"},{id:"asc"}],take:MAX+1});
 if(obs.length>MAX)throw new CashEvidenceError("Too many bank rows; review this statement in smaller periods.");
 if(obs.some(o=>o.status==="UNMATCHED"||o.status==="SUPERSEDED"||
   (o.status==="IGNORED"&&!/^(DUPLICATE|NON_ACCOUNT): .+/.test(o.ignoreReason??""))||
   (o.status==="MATCHED"&&(o.matchItems.length!==1||o.matchItems[0]!.group.voidedAt))||
   (o.status==="IGNORED"&&o.matchItems.length)))
  throw new CashEvidenceError("Statement has unresolved, unsupported or unverified ignored bank rows.");
 const matched=obs.filter(o=>o.status==="MATCHED");
 const groupIds=[...new Set(matched.flatMap(o=>o.matchItems.map(m=>m.groupId)))].sort();
 const groups=await tx.bankMatchGroup.findMany({where:{id:{in:groupIds},cashAccountId:bank.id,
   voidedAt:null},include:{items:{where:{active:true},include:{observation:true,journalLine:{
    include:{entry:{select:{entryDate:true}},ledgerAccount:true}}}}}});
 if(groups.length!==groupIds.length)
  throw new CashEvidenceError("Matched groups lost their original source.");
 const matchedObsIds=new Set(matched.map(x=>x.id));
 const lines:ReconciliationEvidence["lines"]=[];
 for(const group of groups){
  const observations=group.items.flatMap(i=>i.observation?[i.observation]:[]);
  const bookLines=group.items.flatMap(i=>i.journalLine?[i.journalLine]:[]);
  if(!observations.length||!bookLines.length||
     observations.some(o=>!matchedObsIds.has(o.id)||!o.isActive)||
     bookLines.some(l=>l.ledgerAccountId!==bank.ledgerAccountId))
   throw new CashEvidenceError("Cross-period, missing, or wrong-bank match group prevents statement proof.");
  const sumObs=observations.reduce((s,x)=>s+x.signedCents,0);
  const sumLines=bookLines.reduce((s,x)=>s+signed(x),0);
  if(sumObs===0||sumObs!==sumLines||
     [...observations.map(x=>x.signedCents),...bookLines.map(signed)]
       .some(value=>Math.sign(value)!==Math.sign(sumObs)))
   throw new CashEvidenceError("Bank and book match group amounts do not independently balance.");
  for(const l of bookLines)lines.push({id:l.id,entryDate:businessDateKey(l.entry.entryDate),
   signedCents:signed(l),groupId:group.id});
 }
 const included=matched.reduce((s,x)=>s+x.signedCents,0);
 const journalMatchedSum=lines.reduce((s,x)=>s+x.signedCents,0);
 const difference=statement.beginningCents+included-statement.endingCents;
 if(!Number.isSafeInteger(included)||included!==journalMatchedSum||difference!==0)
  throw new CashEvidenceError("Statement differs from independent book/bank evidence; no balancing plug is permitted.");
 const outstandingLines=await tx.journalLine.findMany({where:{
  ledgerAccountId:bank.ledgerAccountId,
  entry:{entryDate:{lte:statement.toOn}},bankMatchItems:{none:{active:true}}},
  select:{id:true,debitCents:true,creditCents:true,entry:{select:{entryDate:true}}},
  take:MAX+1,orderBy:{id:"asc"}});
 if(outstandingLines.length>MAX)
  throw new CashEvidenceError("Outstanding book activity exceeds safe review capacity.");
 const observations:ReconciliationEvidence["observations"]=obs.map(o=>({
   id:o.id,date:businessDateKey(o.postedOn),signedCents:o.signedCents,status:o.status,
   ignoreReason:o.ignoreReason,groupId:o.matchItems[0]?.groupId??null
 }));
 lines.sort((a,b)=>a.id.localeCompare(b.id));
 const outstanding=outstandingLines.map(l=>({id:l.id,
  entryDate:businessDateKey(l.entry.entryDate),signedCents:signed(l)}));
 const prior=statement.includedEvidence&&typeof statement.includedEvidence==="object"&&!Array.isArray(statement.includedEvidence)
  ?(statement.includedEvidence as Record<string,unknown>).firstStatement:null;
 const payload={schemaVersion:1 as const,from:businessDateKey(statement.fromOn),
  to:businessDateKey(statement.toOn),beginningCents:statement.beginningCents,
  endingCents:statement.endingCents,observations,lines,outstanding,
  observationSumCents:included,journalMatchedSumCents:journalMatchedSum,
  bankDifferenceCents:difference,firstStatement:prior??null};
 return {...payload,sourceHash:createHash("sha256").update(JSON.stringify(payload)).digest("hex")};
}
export async function completeBankReconciliation(userId:string,id:string,expectedVersion:number){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const draft=await tx.bankReconciliation.findUnique({where:{id}});
  if(!draft)throw new CashEvidenceError("Statement unavailable.");
  const bank=await lockBank(tx,draft.cashAccountId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BankReconciliation" WHERE "id"=$1 FOR UPDATE',id);
  const current=await tx.bankReconciliation.findUniqueOrThrow({where:{id}});
  if(!current.isCurrent||current.version!==expectedVersion||
     !["DRAFT","REOPENED"].includes(current.status))
   throw new CashEvidenceError("Statement was already completed, replaced, or changed.");
  const others=await currentStatements(tx,bank.id);
  if(others.some(x=>x.id!==id&&x.fromOn>=current.fromOn))
   throw new CashEvidenceError("Complete statements in order; a later period is already current.");
  const prior=others.filter(x=>x.id!==id&&x.toOn<current.fromOn).at(-1);
  if(prior&&(prior.status!=="COMPLETED"||
     addBusinessDays(prior.toOn,1).getTime()!==current.fromOn.getTime()||
     prior.endingCents!==current.beginningCents))
   throw new CashEvidenceError("Previous completed statement is missing or does not continue.");
  const proof=await evidence(tx,bank,current);
  await tx.bankReconciliation.update({where:{id},data:{
   status:"COMPLETED",includedEvidence:proof as unknown as Prisma.InputJsonValue,
   completedAt:new Date(),completedByUserId:userId,version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.bank.statement.complete",
   entityType:"BankReconciliation",entityId:id,newValue:{
    sha256:proof.sourceHash,accountId:bank.id,observationCount:proof.observations.length,
    matchedBookLines:proof.lines.length,outstandingCount:proof.outstanding.length,
    differenceCents:proof.bankDifferenceCents}}});
  return proof;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function reopenBankReconciliation(userId:string,id:string,expectedVersion:number,reason:string){
 const why=reason.trim();
 if(!why||why.length>300)throw new CashEvidenceError("Owner must explain re-opening the statement.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const original=await tx.bankReconciliation.findUnique({where:{id}});
  if(!original)throw new CashEvidenceError("Statement unavailable.");
  await lockBank(tx,original.cashAccountId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BankReconciliation" WHERE "id"=$1 FOR UPDATE',id);
  const prior=await tx.bankReconciliation.findUniqueOrThrow({where:{id}});
  if(!prior.isCurrent||prior.status!=="COMPLETED"||prior.version!==expectedVersion)
   throw new CashEvidenceError("Only the current completed statement can be reopened.");
  if(await tx.bankReconciliation.count({where:{cashAccountId:prior.cashAccountId,
    isCurrent:true,status:"COMPLETED",fromOn:{gt:prior.fromOn}}}))
   throw new CashEvidenceError("Reopen later statements in reverse chronological order first.");
  const priorSnapshot=prior.includedEvidence&&typeof prior.includedEvidence==="object"&&!Array.isArray(prior.includedEvidence)
   ?prior.includedEvidence as Record<string,unknown>:null;
  // Preserve first-statement attestation in every revision. Never erase the
  // original completed proof or present its old SHA as the new draft's proof.
  const carryForward=priorSnapshot?.firstStatement
   ?{stage:"REOPENED",firstStatement:priorSnapshot.firstStatement}
   :{stage:"REOPENED"};
  await tx.bankReconciliation.update({where:{id},data:{isCurrent:false}});
  const next=await tx.bankReconciliation.create({data:{
   cashAccountId:prior.cashAccountId,fromOn:prior.fromOn,toOn:prior.toOn,
   beginningCents:prior.beginningCents,endingCents:prior.endingCents,
   status:"REOPENED",revisionNo:prior.revisionNo+1,priorCompletedId:id,
   includedEvidence:carryForward as Prisma.InputJsonValue,
   reopenReason:why}});
  await tx.auditLog.create({data:{userId,action:"books.bank.statement.reopen",
   entityType:"BankReconciliation",entityId:next.id,newValue:{
    priorCompletedId:id,previousHash:
     (prior.includedEvidence&&typeof prior.includedEvidence==="object"&&!Array.isArray(prior.includedEvidence)
      ?(prior.includedEvidence as Record<string,unknown>).sourceHash:null)??null,
    reason:why,revisionNo:next.revisionNo}}});
  return next.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
