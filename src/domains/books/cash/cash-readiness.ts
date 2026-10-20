import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey, businessDateEnd, businessDaysBetween } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";

type Tx=Prisma.TransactionClient;
const CAP=20000;
const signed=(l:{debitCents:number;creditCents:number})=>l.debitCents-l.creditCents;
type Status="UNKNOWN"|"REVIEW_REQUIRED";
export type EligibleBank={
 id:string;name:string;status:Status;statementTo:string|null;ageDays:number|null;
 endingCents:number|null;clearedLaterInflowsCents:number;bookOutflowsCents:number;
 outstandingBeforeCutoffCents:number;holdsCents:number;eligibleCents:number|null;
 reasons:string[];unmatchedCount:number;bookDifferenceCents:number|null;
};
const protective=(role:string|null)=>
 !!role&&(/^(CARD|DEPOSITS_HELD|CUSTOMER_CREDITS|UNAPPLIED_RECEIPTS|SALES_TAX_UNASSIGNED|SALES_TAX:|USE_TAX:|RETAIL_DELIVERY_FEE_PAYABLE|RDF_PAYABLE)/.test(role));
async function readBank(tx:Tx,bank:{id:string;name:string;ledgerAccountId:string},asOf:Date){
 const reasons:string[]=[],date=businessDateKey(asOf);
 const rows=await tx.bankReconciliation.findMany({where:{cashAccountId:bank.id,isCurrent:true},
  orderBy:{toOn:"desc"},take:2});
 const last=rows[0];
 if(!last||last.status!=="COMPLETED")reasons.push("No current completed bank reconciliation.");
 const cutoff=last?.status==="COMPLETED"?last.toOn:null;
 const age=cutoff?businessDaysBetween(cutoff,asOf):null;
 if(age!==null&&age>7)reasons.push("Statement evidence is over seven calendar days old; confirm newer bank activity.");
 const observed=await tx.bankObservation.findMany({where:{cashAccountId:bank.id,isActive:true,
   postedOn:{lte:asOf}},select:{id:true,postedOn:true,signedCents:true,status:true,ignoreReason:true,
    matchItems:{where:{active:true},select:{groupId:true}}},
   take:CAP+1});
 if(observed.length>CAP)reasons.push("Too many bank observations to verify completely.");
 const after=cutoff?observed.filter(x=>x.postedOn>cutoff):[];
 const unreviewed=after.filter(x=>x.status!=="MATCHED"&&x.status!=="IGNORED");
 if(unreviewed.length)reasons.push("Unmatched or unreviewed settled bank rows exist after last statement.");
 if(after.some(x=>x.status==="IGNORED"&&!["DUPLICATE: ","NON_ACCOUNT: "].some(p=>x.ignoreReason?.startsWith(p))))
  reasons.push("Unknown ignored bank evidence after statement.");
 const bankLines=await tx.journalLine.findMany({where:{ledgerAccountId:bank.ledgerAccountId,
   entry:{entryDate:{lte:asOf}}},select:{id:true,debitCents:true,creditCents:true,
    entry:{select:{entryDate:true}},
    bankMatchItems:{where:{active:true},select:{
      groupId:true,group:{select:{voidedAt:true}},
      journalLineId:true}}},take:CAP+1});
 if(bankLines.length>CAP)reasons.push("Too many book bank lines to verify completely.");
 const laterOutflows=cutoff?bankLines.filter(x=>x.entry.entryDate>cutoff&&signed(x)<0):[];
 const earlierUnpresented=cutoff?bankLines.filter(x=>x.entry.entryDate<=cutoff&&signed(x)<0):[];
 // A pre-cutoff book debit matched to a bank observation after the statement
 // was *outstanding at cutoff*; it must reduce available cash exactly once.
 const matchedLines=await tx.bankMatchItem.findMany({where:{active:true,journalLineId:{in:earlierUnpresented.map(x=>x.id)}},
  select:{journalLineId:true,groupId:true},take:CAP+1});
 const groupIds=[...new Set(matchedLines.map(x=>x.groupId))];
 const observationsForGroup=await tx.bankMatchItem.findMany({where:{
  active:true,groupId:{in:groupIds},bankObservationId:{not:null}},
  select:{groupId:true,observation:{select:{postedOn:true,isActive:true,status:true}}},take:CAP+1});
 const presentedAtCutoff=new Set(observationsForGroup.filter(x=>
  x.observation?.isActive&&x.observation.status==="MATCHED"&&cutoff&&x.observation.postedOn<=cutoff)
  .map(x=>x.groupId));
 const beforeByGroup=new Map(matchedLines.map(x=>[x.journalLineId!,x.groupId]));
 const preOutstanding=earlierUnpresented.filter(x=>{
   const group=beforeByGroup.get(x.id);
   return !group||!presentedAtCutoff.has(group);
 });
 const laterInflow=after.filter(x=>x.signedCents>0&&x.status==="MATCHED"&&x.matchItems.length===1)
   .reduce((s,x)=>s+x.signedCents,0);
 const spentLater=-laterOutflows.reduce((s,x)=>s+signed(x),0);
 const spentEarlier=-preOutstanding.reduce((s,x)=>s+signed(x),0);
 const holds=await tx.cashHold.findMany({where:{cashAccountId:bank.id,
   effectiveOn:{lte:asOf},releasedAt:null},select:{amountCents:true},take:CAP+1});
 if(holds.length>CAP)reasons.push("Too many active cash holds to confirm.");
 const held=holds.reduce((s,x)=>s+x.amountCents,0);
 const eligible=cutoff&&last?last.endingCents+laterInflow-spentLater-spentEarlier-held:null;
 if(eligible!==null&&!Number.isSafeInteger(eligible))reasons.push("Cash arithmetic exceeded safe whole cents.");
 if(eligible!==null&&eligible<0)reasons.push("Adjusted bank account has a cash shortage.");
 // Independent book evidence drift is shown; it is never plugged into availability.
 const booksBalance=bankLines.reduce((s,x)=>s+signed(x),0);
 const observedBookDiff=eligible===null?null:eligible+held-booksBalance;
 if(observedBookDiff!==null&&observedBookDiff!==0)reasons.push("Adjusted statement differs from book cash; inspect unsettled or unsupported sources.");
 if(after.some(x=>x.signedCents>0&&x.status==="MATCHED"&&x.matchItems.length!==1))
  reasons.push("Matched inflow is missing a unique bank claim.");
 return {id:bank.id,name:bank.name,status:reasons.length?"UNKNOWN":"REVIEW_REQUIRED",
  statementTo:cutoff?businessDateKey(cutoff):null,ageDays:age,
  endingCents:cutoff?last!.endingCents:null,clearedLaterInflowsCents:laterInflow,
  bookOutflowsCents:spentLater,outstandingBeforeCutoffCents:spentEarlier,
  holdsCents:held,eligibleCents:eligible,reasons,unmatchedCount:unreviewed.length,
  bookDifferenceCents:observedBookDiff} satisfies EligibleBank;
}
export async function getCashReadiness(userId:string,asOfKey=businessDateKey(new Date())){
 const date=businessDateFromKey(asOfKey);
 if(!date||businessDateKey(date)!==asOfKey||date.getTime()>Date.now())
  throw new CashEvidenceError("Cash readiness needs a valid current/past Colorado day.");
 const asOf=new Date(Math.min(Date.now(),businessDateEnd(asOfKey).getTime()));
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const active=await tx.cashAccount.findMany({where:{active:true},take:100,orderBy:{id:"asc"},
   select:{id:true,name:true,ledgerAccountId:true}});
  const bankResults:EligibleBank[]=[];
  for(const bank of active)bankResults.push(await readBank(tx,bank,asOf));
  const reasons:string[]=[];
  if(!active.length)reasons.push("No registered business checking source.");
  const accounts=await tx.ledgerAccount.findMany({where:{type:"LIABILITY",active:true},
   select:{id:true,name:true,systemRole:true}});
  const liabilityLines=await tx.journalLine.groupBy({by:["ledgerAccountId"],
   where:{ledgerAccountId:{in:accounts.map(x=>x.id)},entry:{entryDate:{lte:asOf}}},
   _sum:{debitCents:true,creditCents:true}});
  const liabilityTotals=new Map(liabilityLines.map(row=>[row.ledgerAccountId,
   (row._sum.creditCents??0)-(row._sum.debitCents??0)]));
  const protectedLiabilities=accounts.filter(a=>protective(a.systemRole)).map(a=>({
   accountId:a.id,name:a.name,sourceRole:a.systemRole,
   requiredCents:Math.max(0,liabilityTotals.get(a.id)??0)}));
  const unknownLiabilities=accounts.filter(x=>!protective(x.systemRole));
  if(unknownLiabilities.length)
   reasons.push("Unclassified or custom liability requires an owner/accountant decision.");
  const bankUnknown=bankResults.flatMap(x=>x.reasons.map(message=>x.name+": "+message));
  reasons.push(...bankUnknown);
  const protectedTotal=protectedLiabilities.reduce((s,x)=>s+x.requiredCents,0);
  const eligible=bankResults.every(x=>x.eligibleCents!==null)&&bankResults.length
   ?bankResults.reduce((s,x)=>s+(x.eligibleCents??0),0):null;
  const afterObligations=eligible===null?null:eligible-protectedTotal;
  if(!Number.isSafeInteger(protectedTotal)||afterObligations!==null&&!Number.isSafeInteger(afterObligations))
   reasons.push("Cash protection arithmetic exceeded the safe whole-cent range.");
  if(afterObligations!==null&&afterObligations<0)reasons.push("Protected liabilities exceed confirmed bank evidence.");
  // K-CASH-4A/B deliberately owns funded envelopes/atomic assignments. Never
  // label the preliminary net pool as ready to assign or as a spending permission.
  reasons.push("Budget backing, card completeness and discretionary envelope state are not yet verified; no funding authorized.");
  return {asOf:asOfKey,status:"UNKNOWN" as const,banks:bankResults,
   eligibleBankCents:eligible,protectedLiabilities,protectedTotalCents:protectedTotal,
   provisionalAfterProtectedCents:afterObligations,unknownLiabilities:unknownLiabilities.map(x=>x.name),
   reasons,mayFund:false,provenance:"Completed bank statement plus posted K journal and hold evidence; not a bank API or payment authorization."};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
/** A hold is for risk evidence not already booked as a bank debit. Never shifts money. */
export async function createCashHold(userId:string,input:{
 accountId:string;amountCents:number;effectiveDate:string;reason:string;
}){
 const date=businessDateFromKey(input.effectiveDate),reason=input.reason.trim();
 if(!date||businessDateKey(date)!==input.effectiveDate||date.getTime()>Date.now()||
  !Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>1_000_000_000||
  reason.length<12||reason.length>300)
  throw new CashEvidenceError("Record a supported hold date, positive whole cents and an explanatory reason.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "CashAccount" WHERE "id"=$1 FOR UPDATE',input.accountId);
  const account=await tx.cashAccount.findUnique({where:{id:input.accountId}});
  if(!account?.active)throw new CashEvidenceError("Active bank account required.");
  const hold=await tx.cashHold.create({data:{cashAccountId:account.id,
   amountCents:input.amountCents,effectiveOn:date,reason,createdByUserId:userId}});
  await tx.auditLog.create({data:{userId,action:"books.bank.hold.create",
   entityType:"CashHold",entityId:hold.id,newValue:{accountId:account.id,
    amountCents:input.amountCents,effectiveDate:input.effectiveDate,reason}}});
  return hold.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function releaseCashHold(userId:string,id:string,version:number,reason:string){
 const why=reason.trim();
 if(why.length<12||why.length>300)throw new CashEvidenceError("Explain why the hold can safely be released.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const hold=await tx.cashHold.findUnique({where:{id}});
  if(!hold)throw new CashEvidenceError("Hold not found.");
  await tx.$queryRawUnsafe('SELECT "id" FROM "CashAccount" WHERE "id"=$1 FOR UPDATE',hold.cashAccountId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "CashHold" WHERE "id"=$1 FOR UPDATE',id);
  const current=await tx.cashHold.findUniqueOrThrow({where:{id}});
  if(current.releasedAt||current.version!==version)
   throw new CashEvidenceError("Hold was already released or changed.");
  await tx.cashHold.update({where:{id},data:{
   releasedAt:new Date(),releasedByUserId:userId,releasedReason:why,version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.bank.hold.release",
   entityType:"CashHold",entityId:id,newValue:{reason:why,version:version+1}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
