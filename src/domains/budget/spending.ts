import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { BudgetEvidenceError } from "./protected";

const hash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const cents=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<=2_000_000_000;
type Split={envelopeId:string;amountCents:number};
/** A budget SPEND is a classification of an existing posted bank journal debit,
 * NEVER another cash debit, expense journal entry, bank transfer, or payment.
 */
export async function assignPostedBankSpending(userId:string,input:{
 journalLineId:string;splits:Split[];commandKey:string;reason:string;
}){
 const reason=input.reason.trim();
 if(reason.length<12||reason.length>300||
    !/^[A-Za-z0-9_-]{10,120}$/.test(input.commandKey)||
    !Array.isArray(input.splits)||!input.splits.length||input.splits.length>60||
    input.splits.some(x=>!x||!x.envelopeId||!cents(x.amountCents))||
    new Set(input.splits.map(x=>x.envelopeId)).size!==input.splits.length)
  throw new BudgetEvidenceError("Select real posted bank spending, unique envelope amounts and an audit reason.");
 const splits=[...input.splits].sort((a,b)=>a.envelopeId.localeCompare(b.envelopeId));
 const proofHash=hash({journalLineId:input.journalLineId,splits,reason});
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
  const bankIds=await tx.cashAccount.findMany({where:{active:true},orderBy:{id:"asc"},
   select:{id:true,ledgerAccountId:true}});
  for(const bank of bankIds)
   await tx.$queryRawUnsafe('SELECT "id" FROM "CashAccount" WHERE "id"=$1 FOR SHARE',bank.id);
  await tx.$queryRawUnsafe('SELECT "id" FROM "JournalLine" WHERE "id"=$1 FOR UPDATE',input.journalLineId);
  for(const x of splits)
   await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',x.envelopeId);
  const [state,source,existing]=await Promise.all([
   tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
   tx.journalLine.findUnique({where:{id:input.journalLineId},include:{
    entry:{include:{lines:{include:{ledgerAccount:true}}}},
    ledgerAccount:true,budgetSpendSplits:true}}),
   tx.budgetMove.findMany({where:{commandKey:input.commandKey}})]);
  if(existing.length){
   if(existing.length!==splits.length||existing.some(x=>x.payloadHash!==proofHash||
    !splits.some(s=>s.envelopeId===x.envelopeId&&x.kind==="SPEND"&&x.signedCents===-s.amountCents)))
    throw new BudgetEvidenceError("A different source command already used this key.");
   return existing[0]!.resultRevision?.toString()??state.revision.toString();
  }
  if(!source||!bankIds.some(b=>b.ledgerAccountId===source.ledgerAccountId)||
    source.creditCents<=0||source.debitCents!==0)
   throw new BudgetEvidenceError("Only an existing business-bank credit line can spend cash.");
  const counterparts=source.entry.lines.filter(x=>x.id!==source.id&&x.debitCents>0);
  if(!counterparts.length||counterparts.some(x=>
   x.ledgerAccount.type!=="EXPENSE"&&x.ledgerAccount.systemRole!=="OWNER_DRAWS"))
   throw new BudgetEvidenceError("This is a protected payment/transfer or mixed journal, not discretionary spending.");
  const ownerDraw=counterparts.some(x=>x.ledgerAccount.systemRole==="OWNER_DRAWS");
  const total=splits.reduce((sum,x)=>sum+x.amountCents,0);
  if(total!==source.creditCents||!Number.isSafeInteger(total))
   throw new BudgetEvidenceError("Discretionary splits must equal the single posted bank outflow exactly.");
  if(source.budgetSpendSplits.length)
   throw new BudgetEvidenceError("This bank journal line was already classified; corrections need an audited inverse.");
  const envelopes=await tx.budgetEnvelope.findMany({where:{id:{in:splits.map(x=>x.envelopeId)},active:true}},select:{id:true,name:true}});
  if(envelopes.length!==splits.length||
    ownerDraw&&envelopes.some(x=>x.name!=="Owner pay"))
   throw new BudgetEvidenceError("Choose active envelopes; owner draws belong to Owner pay only.");
  const newRevision=state.revision+BigInt(1);
  for(const x of splits){
   await tx.budgetSpendSplit.create({data:{
    journalLineId:source.id,envelopeId:x.envelopeId,amountCents:x.amountCents}});
   await tx.budgetMove.create({data:{
    commandKey:input.commandKey,payloadHash:proofHash,resultRevision:newRevision,
    envelopeId:x.envelopeId,signedCents:-x.amountCents,kind:"SPEND",
    sourceType:"JOURNAL_LINE",sourceId:source.id,eventKind:"SPEND",
    reason,actorId:userId}});
  }
  await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.source.spending",entityType:"JournalLine",
   entityId:source.id,newValue:{commandKey:input.commandKey,payloadHash:proofHash,
    signedBankCents:-source.creditCents,split:splits,resultRevision:newRevision.toString()}}});
  return newRevision.toString();
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
/** Correct a mistaken budget classification without reversing a valid K journal. */
export async function reversePostedBankSpending(userId:string,input:{
 journalLineId:string;reason:string;expectedRevision:string;commandKey:string;
}){
 const reason=input.reason.trim();
 if(reason.length<12||reason.length>300||
  !/^[A-Za-z0-9_-]{10,120}$/.test(input.commandKey))
  throw new BudgetEvidenceError("Explain and uniquely identify the spending-classification correction.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  if(state.revision.toString()!==input.expectedRevision)
   throw new BudgetEvidenceError("Budget changed since this correction was reviewed.");
  const source=await tx.journalLine.findUnique({where:{id:input.journalLineId},
   include:{budgetSpendSplits:true}});
  if(!source?.budgetSpendSplits.length)
   throw new BudgetEvidenceError("No spending classification exists for this source.");
  const originals=await tx.budgetMove.findMany({where:{
   sourceType:"JOURNAL_LINE",sourceId:source.id,eventKind:"SPEND",kind:"SPEND"}});
  if(originals.length!==source.budgetSpendSplits.length)
   throw new BudgetEvidenceError("Source splits and move history disagree; stop for review.");
  for(const original of originals){
   await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',original.envelopeId);
   if(await tx.budgetMove.count({where:{reversalOfId:original.id}}))
    throw new BudgetEvidenceError("The original allocation has already been reversed.");
  }
  const next=state.revision+BigInt(1),payloadHash=hash({journalLineId:source.id,
   corrections:originals.map(x=>x.id).sort(),reason});
  for(const original of originals)
   await tx.budgetMove.create({data:{
    commandKey:input.commandKey,payloadHash,resultRevision:next,envelopeId:original.envelopeId,
    signedCents:-original.signedCents,kind:"REVERSAL",sourceType:"JOURNAL_LINE",
    sourceId:source.id,eventKind:"REVERSE_SPEND",reversalOfId:original.id,
    reason,actorId:userId}});
  // Existing split rows are the mutable current version. The original signed
  // postings and source/amount live permanently in immutable BudgetMove/AuditLog.
  await tx.budgetSpendSplit.deleteMany({where:{journalLineId:source.id}});
  await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.source.spending.correct",
   entityType:"JournalLine",entityId:source.id,
   newValue:{reason,originalMoves:originals.map(x=>({id:x.id,cents:x.signedCents,
    envelopeId:x.envelopeId})),resultRevision:next.toString()}}});
  return next.toString();
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
