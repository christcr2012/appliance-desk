import { createHash,randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { BudgetEvidenceError,budgetSnapshotInTx } from "./protected";

const int=(n:number)=>Number.isSafeInteger(n)&&n!==0&&Math.abs(n)<=2_000_000_000;
const hash=(input:unknown)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
type Leg={envelopeId:string;kind:"ASSIGN"|"RELEASE";signedCents:number};
export type BudgetMoveInput={asOf:string;expectedRevision:string;sourceHash:string;commandKey:string;
 moves:Leg[];reason:string};
function normalized(input:BudgetMoveInput){
 if(!/^[A-Za-z0-9_-]{10,120}$/.test(input.commandKey)||
  !/^[0-9a-f]{64}$/.test(input.sourceHash)||
  !/^\d+$/.test(input.expectedRevision)||BigInt(input.expectedRevision)<=BigInt(0))
  throw new BudgetEvidenceError("Refresh the budget snapshot and use a safe command identity.");
 if(!Array.isArray(input.moves)||!input.moves.length||input.moves.length>60)
  throw new BudgetEvidenceError("Select one or more funding movements.");
 const reason=input.reason.trim();
 if(reason.length<12||reason.length>300)throw new BudgetEvidenceError("A reviewed funding reason is required.");
 const legs=new Map<string,Leg>();
 for(const x of input.moves){
  if(!x||!/^[-A-Za-z0-9_]{5,150}$/.test(x.envelopeId)||
   !["ASSIGN","RELEASE"].includes(x.kind)||!int(x.signedCents)||
   x.kind==="ASSIGN"&&x.signedCents<0||x.kind==="RELEASE"&&x.signedCents>0)
   throw new BudgetEvidenceError("Budget legs require matching signed whole-cent movements.");
  const key=x.envelopeId+":"+x.kind,prior=legs.get(key);
  const sum=(prior?.signedCents??0)+x.signedCents;
  if(!int(sum))throw new BudgetEvidenceError("Combined movement exceeds safe whole cents.");
  legs.set(key,{...x,signedCents:sum});
 }
 return {reason,moves:[...legs.values()].sort((a,b)=>
  a.envelopeId.localeCompare(b.envelopeId)||a.kind.localeCompare(b.kind))};
}
/** All application money moves serialize: BudgetState -> BooksPostingRevision ->
 * sorted CashAccount -> sorted BudgetEnvelope. No bank APIs, no journal mutation.
 */
export async function applyBudgetMoves(userId:string,input:BudgetMoveInput){
 const cmd=normalized(input);
 const payloadHash=hash({asOf:input.asOf,revision:input.expectedRevision,
  sourceHash:input.sourceHash,moves:cmd.moves,reason:cmd.reason});
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
  const previous=await tx.budgetMove.findMany({where:{commandKey:input.commandKey},
   select:{envelopeId:true,kind:true,signedCents:true,payloadHash:true,resultRevision:true}});
  if(previous.length){
   if(previous.length!==cmd.moves.length||
     previous.some(x=>x.payloadHash!==payloadHash||
      !cmd.moves.some(m=>m.envelopeId===x.envelopeId&&m.kind===x.kind&&m.signedCents===x.signedCents))||
      previous.some(x=>x.resultRevision===null))
    throw new BudgetEvidenceError("A different command already used this key.");
   return previous[0]!.resultRevision!.toString();
  }
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  if(state.revision.toString()!==input.expectedRevision)
   throw new BudgetEvidenceError("Another budget change occurred; preview again.");
  const accounts=await tx.cashAccount.findMany({where:{active:true},select:{id:true},
   orderBy:{id:"asc"},take:500});
  for(const account of accounts)
   await tx.$queryRawUnsafe('SELECT "id" FROM "CashAccount" WHERE "id"=$1 FOR SHARE',account.id);
  const ids=[...new Set(cmd.moves.map(m=>m.envelopeId))].sort();
  for(const id of ids)
   await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',id);
  const snapshot=await budgetSnapshotInTx(tx,input.asOf);
  if(snapshot.sourceHash!==input.sourceHash)
   throw new BudgetEvidenceError("Books/bank liabilities or envelope values changed; preview again.");
  const before=new Map(snapshot.envelopes.map(x=>[x.id,x]));
  const after=new Map(snapshot.envelopes.map(x=>[x.id,x.balanceCents]));
  for(const leg of cmd.moves){
   const envelope=before.get(leg.envelopeId);
   if(!envelope?.active)throw new BudgetEvidenceError("Cannot move funds to or from an inactive envelope.");
   const current=after.get(leg.envelopeId)!;
   if(leg.kind==="RELEASE"&&leg.signedCents<0&&current< -leg.signedCents)
    throw new BudgetEvidenceError("Cannot release more than the envelope's positive balance.");
   const balance=current+leg.signedCents;
   if(!Number.isSafeInteger(balance))throw new BudgetEvidenceError("Resulting balance is outside safe whole cents.");
   after.set(leg.envelopeId,balance);
  }
  const beforeBacked=snapshot.envelopes.reduce((s,e)=>s+Math.max(0,e.balanceCents),0);
  const afterBacked=[...after.values()].reduce((s,b)=>s+Math.max(0,b),0);
  if(afterBacked>beforeBacked){
   if(!snapshot.mayAssign)throw new BudgetEvidenceError("Cannot allocate: "+snapshot.reasons[0]);
   if(snapshot.readyCents===null||afterBacked-beforeBacked>snapshot.readyCents)
    throw new BudgetEvidenceError("Assignment would borrow protected deposits/tax/card reserves.");
  }
  if(snapshot.envelopes.some(x=>x.balanceCents<0)&&
    cmd.moves.some(x=>x.kind==="ASSIGN"&&
      (before.get(x.envelopeId)?.balanceCents??0)>=0))
   throw new BudgetEvidenceError("Cover negative discretionary balances before new funding.");
  const resultRevision=state.revision+BigInt(1);
  for(const leg of cmd.moves)await tx.budgetMove.create({data:{
   commandKey:input.commandKey,payloadHash,resultRevision,envelopeId:leg.envelopeId,
   signedCents:leg.signedCents,kind:leg.kind,reason:cmd.reason,actorId:userId}});
  await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.money.move",entityType:"BudgetState",
   entityId:"singleton",newValue:{commandKey:input.commandKey,payloadHash,
    sourceHash:input.sourceHash,priorRevision:state.revision.toString(),
    resultRevision:resultRevision.toString(),moves:cmd.moves,reason:cmd.reason}}});
  return resultRevision.toString();
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function undoBudgetMove(userId:string,input:{
 moveId:string;expectedRevision:string;sourceHash:string;asOf:string;reason:string;
 commandKey?:string}){
 const reason=input.reason.trim();
 if(reason.length<12||reason.length>300)throw new BudgetEvidenceError("Explain the correction.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
  const original=await tx.budgetMove.findUnique({where:{id:input.moveId}});
  if(!original||!["ASSIGN","RELEASE"].includes(original.kind))
   throw new BudgetEvidenceError("Only an original reviewed owner allocation/release can be undone.");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',original.envelopeId);
  const undo=await tx.budgetMove.findUnique({where:{reversalOfId:original.id}});
  if(undo)throw new BudgetEvidenceError("This allocation has already been corrected.");
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  const snap=await budgetSnapshotInTx(tx,input.asOf);
  if(state.revision.toString()!==input.expectedRevision||snap.sourceHash!==input.sourceHash)
   throw new BudgetEvidenceError("Budget source changed; review before undo.");
  const balance=snap.envelopes.find(x=>x.id===original.envelopeId)?.balanceCents;
  if(balance===undefined||original.signedCents>0&&balance<original.signedCents)
   throw new BudgetEvidenceError("Cannot undo using money now spent or reserved.");
  if(original.signedCents<0&&!snap.mayAssign)
   throw new BudgetEvidenceError("Reversing this release would require unverified positive backing.");
  const signedCents=-original.signedCents,resultRevision=state.revision+BigInt(1);
  await tx.budgetMove.create({data:{
   commandKey:input.commandKey??randomUUID(),payloadHash:hash({original:original.id,reason}),
   resultRevision,envelopeId:original.envelopeId,signedCents,kind:"REVERSAL",
   sourceType:"BUDGET",sourceId:original.id,eventKind:"OWNER_UNDO",
   reversalOfId:original.id,reason,actorId:userId}});
  await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.money.undo",entityType:"BudgetMove",
   entityId:original.id,newValue:{reason,undoCents:signedCents,resultRevision:resultRevision.toString()}}});
  return resultRevision.toString();
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
