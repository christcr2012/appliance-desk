import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey,businessDateKey,businessDateEnd } from "@/lib/business-date";
import { readCashReadinessInTx } from "@/domains/books/cash/cash-readiness";

type Tx=Prisma.TransactionClient;
export class BudgetEvidenceError extends Error {}
const safe=(n:number)=>Number.isSafeInteger(n)&&Math.abs(n)<=2_000_000_000;
function day(key:string){
 const d=businessDateFromKey(key);
 if(!d||businessDateKey(d)!==key||d.getTime()>Date.now())
  throw new BudgetEvidenceError("Select a real past or current Colorado day.");
 return new Date(Math.min(Date.now(),businessDateEnd(key).getTime()));
}
type Attestation={schemaVersion:1;asOf:string;accountIds:string[];bankSourceReference:string;
 cardSourceReference:string;liabilitySourceReference:string;ownerId:string;sourceRevision:string;confirmedAt:string};
function checked(x:Prisma.JsonValue|null):Attestation|null{
 if(!x||Array.isArray(x)||typeof x!=="object")return null;
 const r=x as Record<string,unknown>;
 if(r.schemaVersion!==1||typeof r.asOf!=="string"||typeof r.ownerId!=="string"||
    typeof r.bankSourceReference!=="string"||typeof r.cardSourceReference!=="string"||
    typeof r.liabilitySourceReference!=="string"||typeof r.sourceRevision!=="string"||
    typeof r.confirmedAt!=="string"||!Array.isArray(r.accountIds)||
    !r.accountIds.every(x=>typeof x==="string"))return null;
 return r as Attestation;
}
const priority=(role:string|null)=>/^(DEPOSITS_HELD|CUSTOMER_CREDITS|UNAPPLIED_RECEIPTS)$/.test(role??"")?0:
 /(TAX|RDF|FEE_PAYABLE)/.test(role??"")?1:2;
/** Read ONLY inside an actor-checked transaction. No changes to financial evidence. */
export async function budgetSnapshotInTx(tx:Tx,asOf:string){
 const at=day(asOf);
 const [state,settings,rev,bank,envelopes,sums]=await Promise.all([
  tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
  tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"}}),
  tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
  readCashReadinessInTx(tx,asOf,at),
  tx.budgetEnvelope.findMany({orderBy:[{sortOrder:"asc"},{id:"asc"}],take:500}),
  tx.budgetMove.groupBy({by:["envelopeId"],_sum:{signedCents:true}})
 ]);
 const byEnvelope=new Map(sums.map(x=>[x.envelopeId,x._sum.signedCents??0]));
 const balances=envelopes.map(e=>({
  id:e.id,name:e.name,groupLabel:e.groupLabel,sortOrder:e.sortOrder,
  active:e.active,version:e.version,balanceCents:byEnvelope.get(e.id)??0
 }));
 const discretionaryBackedCents=balances.reduce((s,e)=>s+Math.max(0,e.balanceCents),0);
 const liabilities=[...bank.protectedLiabilities].sort((a,b)=>
  priority(a.sourceRole)-priority(b.sourceRole)||a.accountId.localeCompare(b.accountId));
 let protectedBacking=Math.max(0,(bank.eligibleBankCents??0)-discretionaryBackedCents);
 const protectedLiabilities=liabilities.map(x=>{
  const fundedCents=Math.min(protectedBacking,x.requiredCents);
  protectedBacking-=fundedCents;
  return {...x,fundedCents,shortageCents:x.requiredCents-fundedCents};
 });
 const readyCents=bank.eligibleBankCents===null?null:
  bank.eligibleBankCents-bank.protectedTotalCents-discretionaryBackedCents;
 const reasons=bank.reasons.filter(x=>!x.startsWith("Budget backing, card completeness"));
 const proof=checked(state.readinessAttestation);
 const accountIds=bank.banks.map(x=>x.id).sort();
 if(!settings.cashBudgetEnabled||!state.startOn)reasons.push("Budget setup is OFF.");
 for(const item of bank.banks){
  if(item.ageDays!==null&&item.ageDays>settings.bankEvidenceMaxAgeDays)
   reasons.push(item.name+": owner-configured bank evidence age exceeded.");
 }
 if(state.startOn&&state.startOn>at)reasons.push("Budget start is in the future.");
 if(!proof||proof.asOf!==asOf||
  JSON.stringify([...proof.accountIds].sort())!==JSON.stringify(accountIds))
  reasons.push("Independent bank/account review is missing for the chosen date.");
 if(proof?.sourceRevision!==rev.revision.toString())
  reasons.push("New journal activity requires owner to recheck banking and debt evidence.");
 if(!proof||[proof.bankSourceReference,proof.cardSourceReference,proof.liabilitySourceReference]
  .some(x=>x.trim().length<12))
  reasons.push("Bank, card or liability source reference is incomplete.");
 for(const b of bank.banks){
  if(b.statementTo!==asOf)reasons.push(b.name+": verified statement must cover the entire selected date.");
  if(b.bookDifferenceCents!==0||b.status==="UNKNOWN")
   reasons.push(b.name+": bank and Books have unresolved differences.");
 }
 if(bank.unknownLiabilities.length)reasons.push("Unclassified liabilities need review.");
 // A posted expense must never be hidden because it has not yet been given a
 // budget envelope. Do not require an allocation to POST financial reality;
 // instead block new positive discretionary funding and show the shortfall.
 const sourceLedgers=await tx.cashAccount.findMany({where:{active:true},
  select:{ledgerAccountId:true}});
 const bankOutflows=state.startOn?await tx.journalLine.findMany({where:{
  ledgerAccountId:{in:sourceLedgers.map(x=>x.ledgerAccountId)},
  creditCents:{gt:0},entry:{entryDate:{gte:state.startOn,lte:at}}},
  include:{budgetSpendSplits:{where:{active:true}},entry:{include:{
   lines:{include:{ledgerAccount:{select:{type:true,systemRole:true}}}}}}},
  take:10001}):[];
 if(bankOutflows.length>10000)reasons.push("Too many bank outflows to confirm spending classifications.");
 let unassignedCount=0,unassignedCents=0;
 for(const line of bankOutflows){
  const counterparts=line.entry.lines.filter(x=>x.id!==line.id&&x.debitCents>0);
  const discretionary=counterparts.some(x=>x.ledgerAccount.type==="EXPENSE"||
   x.ledgerAccount.systemRole==="OWNER_DRAWS");
  const protectedOrTransfer=counterparts.length>0&&counterparts.every(x=>
   x.ledgerAccount.type==="LIABILITY"||x.ledgerAccount.type==="ASSET");
  if(discretionary){
   const assigned=line.budgetSpendSplits.reduce((s,x)=>s+x.amountCents,0);
   if(assigned!==line.creditCents){
    unassignedCount++;unassignedCents+=line.creditCents-Math.min(line.creditCents,assigned);
   }
  }else if(!protectedOrTransfer){
   unassignedCount++;unassignedCents+=line.creditCents;
  }
 }
 if(unassignedCount)reasons.push("Unassigned or unclassified posted business-bank outflow must be reviewed before new funding.");

 if(!safe(discretionaryBackedCents)||readyCents!==null&&!safe(readyCents)||
  balances.some(x=>!safe(x.balanceCents)))reasons.push("Unsafe cash arithmetic.");
 if(readyCents!==null&&readyCents<0)reasons.push("Protected/discretionary funding exceeds confirmed bank evidence.");
 if(balances.some(x=>x.balanceCents<0))reasons.push("Negative envelope must be funded before other allocations.");
 const sourceHash=createHash("sha256").update(JSON.stringify({
  date:asOf,bookRevision:rev.revision.toString(),bank:bank.banks,
  protected:liabilities.map(x=>[x.accountId,x.requiredCents]),
  balances:balances.map(x=>[x.id,x.balanceCents]),unassignedCount,unassignedCents,
  proof,enabled:settings.cashBudgetEnabled
 })).digest("hex");
 const mayAssign=reasons.length===0&&readyCents!==null&&readyCents>=0;
 return {asOf,stateRevision:state.revision.toString(),bookRevision:rev.revision.toString(),
  enabled:settings.cashBudgetEnabled,startOn:state.startOn?businessDateKey(state.startOn):null,
  status:mayAssign?"READY" as const:bank.eligibleBankCents===null?"UNKNOWN" as const:"REVIEW_REQUIRED" as const,
  eligibleBankCents:bank.eligibleBankCents,protectedTotalCents:bank.protectedTotalCents,
  envelopes:balances,protectedLiabilities,unknownLiabilities:bank.unknownLiabilities,
  discretionaryBackedCents,readyCents,reasons,sourceHash,mayAssign,
  unassignedCount,unassignedCents,bankEvidence:bank.banks};
}
export async function getBudgetSnapshot(userId:string,asOf=businessDateKey(new Date())){
 day(asOf);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  return budgetSnapshotInTx(tx,asOf);
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export async function attestBudgetSources(userId:string,input:{
 asOf:string;expectedRevision:string;bankSourceReference:string;
 cardSourceReference:string;liabilitySourceReference:string;confirmAll:boolean;
}){
 day(input.asOf);
 if(!input.confirmAll||[input.bankSourceReference,input.cardSourceReference,input.liabilitySourceReference]
  .some(x=>x.trim().length<12||x.trim().length>250))
  throw new BudgetEvidenceError("Independently check real bank, card and liability evidence.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
  const [state,rev,accounts]=await Promise.all([
   tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
   tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
   tx.cashAccount.findMany({where:{active:true},select:{id:true},orderBy:{id:"asc"}})]);
  if(state.revision.toString()!==input.expectedRevision)
   throw new BudgetEvidenceError("Budget changed; refresh and check.");
  if(!accounts.length)throw new BudgetEvidenceError("Register and reconcile a checking source first.");
  const proof:Attestation={schemaVersion:1,asOf:input.asOf,accountIds:accounts.map(a=>a.id),
   bankSourceReference:input.bankSourceReference.trim(),cardSourceReference:input.cardSourceReference.trim(),
   liabilitySourceReference:input.liabilitySourceReference.trim(),ownerId:userId,
   sourceRevision:rev.revision.toString(),confirmedAt:new Date().toISOString()};
  await tx.budgetState.update({where:{id:"singleton"},data:{
   readinessAttestation:proof as unknown as Prisma.InputJsonValue,revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.source.attest",entityType:"BudgetState",
   entityId:"singleton",newValue:proof}});
  return proof;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function setBudgetActivation(userId:string,input:{
 enabled:boolean;startDate:string;expectedRevision:string;reason:string;
}){
 const at=day(input.startDate),why=input.reason.trim();
 if(why.length<12||why.length>300)throw new BudgetEvidenceError("Explain the owner setup decision.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  if(state.revision.toString()!==input.expectedRevision)throw new BudgetEvidenceError("Budget changed; refresh.");
  if(input.enabled){
   const snap=await budgetSnapshotInTx(tx,businessDateKey(at));
   const failures=snap.reasons.filter(x=>x!=="Budget setup is OFF.");
   if(failures.length||!checked(state.readinessAttestation))
    throw new BudgetEvidenceError("Budget source not ready: "+(failures[0]??"owner proof missing"));
  }
  await tx.businessSettings.update({where:{id:"singleton"},data:{
   cashBudgetEnabled:input.enabled,cashBudgetStartOn:businessDateFromKey(input.startDate)!}});
  await tx.budgetState.update({where:{id:"singleton"},data:{
   startOn:businessDateFromKey(input.startDate)!,revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.setup.activation",
   entityType:"BudgetState",entityId:"singleton",
   newValue:{enabled:input.enabled,startDate:input.startDate,reason:why}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
