import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays,businessDateFromKey,businessDateKey } from "@/lib/business-date";
import { BudgetEvidenceError,budgetSnapshotInTx } from "./protected";
import { type BudgetRecurrence,type BudgetTargetKind,plannedDueKeys,
 suggestedTarget,fundNowNeed,fundingSuggestion,type BudgetFundCandidate } from "./planning-math";

type Tx=Prisma.TransactionClient;
const cents=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<=2_000_000_000;
const why=(value:string)=>{
 const r=value.trim();
 if(r.length<12||r.length>300)throw new BudgetEvidenceError("Explain this reviewed budget decision (12–300 characters).");
 return r;
};
const date=(key:string)=>{
 const at=businessDateFromKey(key);
 if(!at||businessDateKey(at)!==key)throw new BudgetEvidenceError("Use a valid Colorado date.");
 return at;
};
const identity=(key:string)=>{
 if(!/^[A-Za-z0-9_-]{10,120}$/.test(key))
  throw new BudgetEvidenceError("Use a stable unique operation identity.");
 return key;
};
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kinds=["MONTHLY_SPEND","SAVE_BY_DATE","MAINTAIN_BALANCE"] as const;
const recurrences=["NONE","MONTHLY","QUARTERLY","ANNUAL"] as const;
const quality=["EXACT","ESTIMATE"] as const;
const lockState=async(tx:Tx)=>{
 await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
};
const lockBooks=async(tx:Tx)=>{
 await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
};
async function revision(tx:Tx){
 await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
}
async function materialize(tx:Tx,plan:{id:string;dueOn:Date;recurrence:string;
 amountCents:number;version:number;active:boolean},today:string,horizon:number){
 if(!plan.active)return;
 const anchor=businessDateKey(plan.dueOn),through=businessDateKey(addBusinessDays(date(today),horizon));
 const due=plannedDueKeys({anchor,recurrence:plan.recurrence as BudgetRecurrence,
  from:today,through});
 for(const key of due){
  const on=date(key);
  const existing=await tx.budgetCostOccurrence.findUnique({
   where:{planId_dueOn:{planId:plan.id,dueOn:on}},include:{settlements:true}});
  if(existing){
   const paid=existing.settlements.filter(s=>!s.reversalOfId&&!existing.settlements.some(
    other=>other.reversalOfId===s.id)).reduce((sum,s)=>sum+s.amountCents,0);
   // Updates never silently replace already paid or partially paid obligations.
   if(paid>0||existing.status==="CANCELLED"||existing.sourceRevision===plan.version)continue;
   await tx.budgetCostOccurrence.update({where:{id:existing.id},data:{
    amountCents:plan.amountCents,sourceRevision:plan.version,version:{increment:1}}});
  }else await tx.budgetCostOccurrence.create({data:{
   planId:plan.id,dueOn:on,amountCents:plan.amountCents,sourceRevision:plan.version}});
 }
}
export async function saveBudgetCostPlan(userId:string,input:{
 planId?:string;expectedVersion?:number;envelopeId:string;name:string;
 amountCents:number;amountQuality:"EXACT"|"ESTIMATE";dueOn:string;
 recurrence:BudgetRecurrence;sourceType?:"MANUAL"|"RECURRING_EXPENSE"|"PURCHASE_ORDER"|"TELECOM_PLAN";
 sourceId?:string;active?:boolean;reason:string;today?:string;
}){
 const reason=why(input.reason),name=input.name.trim(),due=date(input.dueOn);
 if(name.length<1||name.length>200||!cents(input.amountCents)||
  !quality.includes(input.amountQuality)||!recurrences.includes(input.recurrence))
  throw new BudgetEvidenceError("Choose a name, exact or estimated amount, valid due day and recurrence.");
 const sourceType=input.sourceType??"MANUAL",sourceId=input.sourceId?.trim()||null;
 if(!["MANUAL","RECURRING_EXPENSE","PURCHASE_ORDER","TELECOM_PLAN"].includes(sourceType)||
  sourceType==="MANUAL"&&sourceId!==null||sourceType!=="MANUAL"&&!sourceId)
  throw new BudgetEvidenceError("A linked bill must name exactly one verified existing source.");
 const today=input.today??businessDateKey(new Date());
 date(today);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await lockState(tx);
  const envelope=await tx.budgetEnvelope.findUnique({where:{id:input.envelopeId}});
  if(!envelope?.active)throw new BudgetEvidenceError("Choose an active discretionary envelope.");
  const settings=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  if(sourceType==="RECURRING_EXPENSE"){
   const source=await tx.recurringExpense.findUnique({where:{id:sourceId!}});
   if(!source?.active)throw new BudgetEvidenceError("Recurring expense source is not active.");
   if(input.recurrence!=="MONTHLY"||input.amountCents!==source.amountCents||
      Number(input.dueOn.slice(8))!==source.dayOfMonth)
    throw new BudgetEvidenceError("The linked recurring expense's saved date and amount must match its plan.");
  }
  if(sourceType==="PURCHASE_ORDER"){
   const order=await tx.purchaseOrder.findUnique({where:{id:sourceId!},include:{lines:true}});
   if(!order)throw new BudgetEvidenceError("The purchase commitment no longer exists.");
   if(input.amountQuality!=="ESTIMATE")throw new BudgetEvidenceError("A purchase order is a commitment estimate until an actual posted payment is verified.");
   // Receipt of parts/appliances is stock evidence, not bill payment.
   if(!order.lines.length)throw new BudgetEvidenceError("Purchase order has no committed lines to plan.");
  }
  if(sourceType==="TELECOM_PLAN"){
   const statement=await tx.telecomStatement.findUnique({where:{id:sourceId!}});
   if(!statement||statement.state!=="VERIFIED"||statement.currency!=="USD")
    throw new BudgetEvidenceError("Telecom commitment needs an existing, verified USD provider statement. Unverified usage is not booked or paid.");
   if(input.amountQuality!=="ESTIMATE")
    throw new BudgetEvidenceError("Planning future telecom spending from a past statement remains an estimate.");
  }
  const old=input.planId?await tx.budgetCostPlan.findUnique({
   where:{id:input.planId},include:{occurrences:{include:{settlements:true}}}}):null;
  // Source identity belongs to one obligation for its entire life, including
  // inactive plans. BudgetState's row lock serializes competing OWNER submissions;
  // the matching partial database unique index guards direct/other writers too.
  if(sourceId!==null){
   const duplicate=await tx.budgetCostPlan.findFirst({where:{
    sourceType,sourceId,...(input.planId?{id:{not:input.planId}}:{})},
    select:{id:true}});
   if(duplicate)throw new BudgetEvidenceError(
    "This verified source already has a cost plan. Revise its original record instead.");
  }
  if(input.planId&&(!old||old.version!==input.expectedVersion))
   throw new BudgetEvidenceError("This bill changed. Refresh the version before editing.");
  if(!old&&due.getTime()<date(today).getTime())
   throw new BudgetEvidenceError("New cost plans require a current or future original due day.");
  if(old&&(old.sourceType!==sourceType||old.sourceId!==sourceId))
   throw new BudgetEvidenceError("A linked source cannot be replaced. Cancel and create a distinct reviewed plan.");
  const common={envelopeId:input.envelopeId,name,amountCents:input.amountCents,
   amountQuality:input.amountQuality,dueOn:due,recurrence:input.recurrence,
   anchorDay:Number(input.dueOn.slice(8)),anchorMonth:Number(input.dueOn.slice(5)),
   active:input.active??true};
  if(old&&(old.envelopeId!==input.envelopeId||old.dueOn.getTime()!==due.getTime()||
    old.recurrence!==input.recurrence)){
   // The prior due-date identities cannot disappear; historical rows stay canceled
   // except where source evidence already partially/fully settled a due period.
   for(const item of old.occurrences){
    const paid=item.settlements.filter(s=>!s.reversalOfId&&
     !item.settlements.some(r=>r.reversalOfId===s.id)).reduce((s,x)=>s+x.amountCents,0);
    if(paid===0&&item.status!=="CANCELLED")
     await tx.budgetCostOccurrence.update({where:{id:item.id},data:{
      status:"CANCELLED",version:{increment:1}}});
   }
  }
  const plan=old?await tx.budgetCostPlan.update({where:{id:old.id},data:{
   ...common,version:{increment:1}}}):
   await tx.budgetCostPlan.create({data:{...common,sourceType,sourceId}});
  if(!plan.active){
   const unpaid=await tx.budgetCostOccurrence.findMany({where:{planId:plan.id,
    status:{in:["PLANNED","PART_PAID"]}},include:{settlements:true}});
   for(const occ of unpaid){
    if(netPaid(occ.settlements)===0)
     await tx.budgetCostOccurrence.update({where:{id:occ.id},data:{
      status:"CANCELLED",version:{increment:1}}});
   }
  }else await materialize(tx,plan,today,settings.budgetPlanningHorizonDays);
  await revision(tx);
  await tx.auditLog.create({data:{userId,action:old?"budget.plan.revise":"budget.plan.create",
   entityType:"BudgetCostPlan",entityId:plan.id,newValue:{
    previous:old?{version:old.version,amountCents:old.amountCents,
     dueOn:businessDateKey(old.dueOn),active:old.active}:null,
    next:{...common,dueOn:input.dueOn,version:plan.version},sourceType,sourceId,reason}}});
  return plan.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function saveBudgetTarget(userId:string,input:{
 envelopeId:string;expectedVersion?:number;kind:BudgetTargetKind;
 amountCents:number;dueOn?:string|null;repeat?:"NONE"|"ANNUAL";active?:boolean;reason:string;
}){
 const reason=why(input.reason),repeat=input.repeat??"NONE";
 if(!kinds.includes(input.kind)||!cents(input.amountCents)||
  !["NONE","ANNUAL"].includes(repeat)||
  input.kind==="SAVE_BY_DATE"&&!input.dueOn||
  input.kind!=="SAVE_BY_DATE"&&Boolean(input.dueOn)||
  input.kind!=="SAVE_BY_DATE"&&repeat!=="NONE")
  throw new BudgetEvidenceError("Target kind, due day, frequency or amount is invalid.");
 const due=input.dueOn?date(input.dueOn):null;
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await lockState(tx);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',input.envelopeId);
  const envelope=await tx.budgetEnvelope.findUnique({where:{id:input.envelopeId}});
  if(!envelope?.active)throw new BudgetEvidenceError("Select an active discretionary envelope.");
  const old=await tx.budgetTarget.findUnique({where:{envelopeId:input.envelopeId}});
  if(old&&old.version!==input.expectedVersion)
   throw new BudgetEvidenceError("Target changed. Refresh before saving.");
  if(!old&&input.expectedVersion!==undefined)
   throw new BudgetEvidenceError("This target no longer exists.");
  const common={kind:input.kind,amountCents:input.amountCents,dueOn:due,repeat,
   active:input.active??true};
  const next=old?await tx.budgetTarget.update({where:{id:old.id},data:{
   ...common,version:{increment:1}}}):
   await tx.budgetTarget.create({data:{envelopeId:input.envelopeId,...common}});
  await revision(tx);
  await tx.auditLog.create({data:{userId,action:"budget.target.configure",
   entityType:"BudgetTarget",entityId:next.id,newValue:{prior:old?{
    kind:old.kind,amountCents:old.amountCents,dueOn:old.dueOn?.toISOString()??null,
    repeat:old.repeat,active:old.active,version:old.version}:null,
    current:{...common,dueOn:input.dueOn??null,version:next.version},reason}}});
  return next.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
function netPaid<T extends {id:string;amountCents:number;reversalOfId:string|null}>(rows:T[]){
 const reversed=new Set(rows.flatMap(r=>r.reversalOfId?[r.reversalOfId]:[]));
 return rows.filter(r=>r.reversalOfId===null&&!reversed.has(r.id))
  .reduce((sum,r)=>sum+r.amountCents,0);
}
export async function settleBudgetCost(userId:string,input:{
 occurrenceId:string;expenseId:string;amountCents:number;commandKey:string;
 expectedRevision:string;reason:string;
}){
 const reason=why(input.reason),key=identity(input.commandKey);
 if(!cents(input.amountCents)||!/^[0-9]+$/.test(input.expectedRevision))
  throw new BudgetEvidenceError("Use a positive whole-cent actual payment and reviewed revision.");
 const digest=hash({occurrenceId:input.occurrenceId,expenseId:input.expenseId,
  amountCents:input.amountCents,reason});
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await lockState(tx);await lockBooks(tx);
  const prior=await tx.budgetCostSettlement.findUnique({where:{commandKey:key}});
  if(prior){
   if(prior.payloadHash!==digest||prior.reversalOfId)
    throw new BudgetEvidenceError("Command key was reused for different payment evidence.");
   return prior.id;
  }
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  if(state.revision.toString()!==input.expectedRevision)
   throw new BudgetEvidenceError("Budget changed; review the actual source again.");
  const occ=await tx.budgetCostOccurrence.findUnique({where:{id:input.occurrenceId},
   include:{settlements:true,plan:true}});
  if(!occ||occ.status==="CANCELLED"||!occ.plan.active)
   throw new BudgetEvidenceError("The planned bill is canceled or unavailable.");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',occ.plan.envelopeId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetCostOccurrence" WHERE "id"=$1 FOR UPDATE',occ.id);
  const expense=await tx.expense.findUnique({where:{id:input.expenseId}});
  const journal=await tx.journalEntry.findFirst({where:{sourceType:"EXPENSE",
   sourceId:input.expenseId,eventKind:"EXPENSE_POSTED"},select:{id:true}});
  if(!expense||expense.status!=="POSTED"||!journal||!cents(expense.amountCents))
   throw new BudgetEvidenceError("Only an existing posted Books expense can settle a planned bill.");
  // This strict one-source-one-occurrence rule avoids attributing the same
  // booked expense to multiple future obligations.
  const elsewhere=await tx.budgetCostSettlement.findMany({where:{
   sourceType:"EXPENSE",sourceId:input.expenseId,reversalOfId:null}});
  if(elsewhere.length)
   throw new BudgetEvidenceError("This posted expense already settled a bill; reverse that link first.");
  if(occ.plan.sourceType==="RECURRING_EXPENSE"&&occ.plan.sourceId!==expense.recurringExpenseId)
   throw new BudgetEvidenceError("Posted source does not match the recurring bill template.");
  if(occ.plan.sourceType==="PURCHASE_ORDER"&&occ.plan.sourceId!==expense.purchaseOrderId)
   throw new BudgetEvidenceError("Posted source does not match the purchase commitment.");
  const paid=netPaid(occ.settlements);
  if(paid+input.amountCents>occ.amountCents||input.amountCents>expense.amountCents)
   throw new BudgetEvidenceError("Actual payment exceeds the original bill or verified expense.");
  const saved=await tx.budgetCostSettlement.create({data:{
   occurrenceId:occ.id,sourceType:"EXPENSE",sourceId:expense.id,
   amountCents:input.amountCents,commandKey:key,payloadHash:digest}});
  await tx.budgetCostOccurrence.update({where:{id:occ.id},data:{
   status:paid+input.amountCents===occ.amountCents?"PAID":"PART_PAID",
   version:{increment:1}}});
  await revision(tx);
  await tx.auditLog.create({data:{userId,action:"budget.cost.settle",
   entityType:"BudgetCostSettlement",entityId:saved.id,
   newValue:{occurrenceId:occ.id,sourceType:"EXPENSE",sourceId:expense.id,
    sourceJournalId:journal.id,amountCents:input.amountCents,reason,key}}});
  return saved.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function reverseBudgetCostSettlement(userId:string,input:{
 settlementId:string;commandKey:string;expectedRevision:string;reason:string;
}){
 const reason=why(input.reason),key=identity(input.commandKey);
 if(!/^\d+$/.test(input.expectedRevision))throw new BudgetEvidenceError("Use a reviewed revision.");
 const digest=hash({original:input.settlementId,reason});
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);await lockState(tx);await lockBooks(tx);
  const prior=await tx.budgetCostSettlement.findUnique({where:{commandKey:key}});
  if(prior){
   if(prior.payloadHash!==digest||prior.reversalOfId!==input.settlementId)
    throw new BudgetEvidenceError("Changed correction cannot reuse this command key.");
   return prior.id;
  }
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  if(state.revision.toString()!==input.expectedRevision)
   throw new BudgetEvidenceError("Budget changed; review correction.");
  const original=await tx.budgetCostSettlement.findUnique({where:{id:input.settlementId},
   include:{occurrence:{include:{plan:true,settlements:true}}}});
  if(!original||original.reversalOfId)
   throw new BudgetEvidenceError("Choose an original, still-counted payment link.");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',original.occurrence.plan.envelopeId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetCostOccurrence" WHERE "id"=$1 FOR UPDATE',original.occurrenceId);
  if(original.occurrence.settlements.some(s=>s.reversalOfId===original.id))
   throw new BudgetEvidenceError("The same payment link was already corrected.");
  const inverse=await tx.budgetCostSettlement.create({data:{
   occurrenceId:original.occurrenceId,sourceType:original.sourceType,
   sourceId:original.sourceId,amountCents:original.amountCents,
   commandKey:key,payloadHash:digest,reversalOfId:original.id}});
  const remains=netPaid(original.occurrence.settlements)-original.amountCents;
  await tx.budgetCostOccurrence.update({where:{id:original.occurrenceId},data:{
   status:remains===0?"PLANNED":"PART_PAID",version:{increment:1}}});
  await revision(tx);
  await tx.auditLog.create({data:{userId,action:"budget.cost.settlement.reverse",
   entityType:"BudgetCostSettlement",entityId:inverse.id,newValue:{
    originalId:original.id,amountCents:original.amountCents,reason,key}}});
  return inverse.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}

/** OWNER-controlled, id-cursor paged date refresh. One transaction per page;
 * never silently truncate after a fixed source window or charge/pay a bill.
 * An older/deactivated cursor is rejected so the owner can restart safely. */
export async function refreshBudgetOccurrenceHorizon(
 userId:string,today=businessDateKey(new Date()),cursor?:string){
 date(today);
 if(cursor!==undefined&&(!/^[a-zA-Z0-9_-]{1,64}$/.test(cursor)))
  throw new BudgetEvidenceError("Invalid plan refresh cursor. Start from the first page.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await lockState(tx);
  if(cursor){
   const prior=await tx.budgetCostPlan.findUnique({where:{id:cursor}});
   if(!prior?.active)throw new BudgetEvidenceError(
    "Plan refresh cursor changed. Restart the refresh from the first page.");
  }
  const settings=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  // Stable ID ordering permits continuation without skipping or duplicating a page.
  // A fresh full pass includes plans inserted before a previous cursor.
  const pageSize=25;
  const page=await tx.budgetCostPlan.findMany({where:{active:true},
   orderBy:{id:"asc"},take:pageSize+1,
   ...(cursor?{cursor:{id:cursor},skip:1}:{})});
  const plans=page.slice(0,pageSize);
  for(const plan of plans)await materialize(tx,plan,today,settings.budgetPlanningHorizonDays);
  const nextCursor=page.length>pageSize?plans[plans.length-1]!.id:null;
  await revision(tx);
  await tx.auditLog.create({data:{userId,action:"budget.plan.refresh-horizon",
   entityType:"BudgetState",entityId:"singleton",newValue:{
    date:today,plannedCount:plans.length,afterCursor:cursor??null,
    nextCursor,horizon:settings.budgetPlanningHorizonDays}}});
  return {processed:plans.length,nextCursor};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
/**
 * Source-owned linked schedule. Invoked within the exact recurring-template
 * edit transaction only after the existing Books role/validation gates.
 * Already-settled occurrence snapshots are NEVER rewritten or deleted.
 */
export async function synchronizeLinkedRecurringPlanInTx(tx:Tx,userId:string,source:{
 id:string;name:string;amountCents:number;dayOfMonth:number;active:boolean
}){
 const existing=await tx.budgetCostPlan.findFirst({where:{
  sourceType:"RECURRING_EXPENSE",sourceId:source.id},include:{
  occurrences:{include:{settlements:true},take:500}}});
 if(!existing)return;
 if(!cents(source.amountCents)||!Number.isInteger(source.dayOfMonth)||
  source.dayOfMonth<1||source.dayOfMonth>28)
  throw new BudgetEvidenceError("Recurring source contains an invalid verified amount or due day.");
 await lockState(tx);
 const now=businessDateKey(new Date()),anchor=businessDateKey(existing.dueOn);
 const revisedKey=anchor.slice(0,8)+String(source.dayOfMonth).padStart(2,"0");
 const revisedOn=date(revisedKey),updated=await tx.budgetCostPlan.update({
  where:{id:existing.id},data:{name:source.name,amountCents:source.amountCents,
  dueOn:revisedOn,anchorDay:source.dayOfMonth,active:source.active,
  version:{increment:1}}});
 for(const old of existing.occurrences){
  if(netPaid(old.settlements)>0)continue;
  const oldKey=businessDateKey(old.dueOn);
  if(oldKey<now)continue;
  const changedDate=source.dayOfMonth!==Number(oldKey.slice(8));
  if(!source.active||changedDate){
   if(old.status!=="CANCELLED")await tx.budgetCostOccurrence.update({
    where:{id:old.id},data:{status:"CANCELLED",version:{increment:1}}});
  }else if(old.status==="PLANNED")
   await tx.budgetCostOccurrence.update({where:{id:old.id},data:{
    amountCents:source.amountCents,sourceRevision:updated.version,version:{increment:1}}});
 }
 if(source.active){
  const settings=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  await materialize(tx,updated,now,settings.budgetPlanningHorizonDays);
 }
 await revision(tx);
 await tx.auditLog.create({data:{userId,action:"budget.plan.linked-recurring-source",
  entityType:"BudgetCostPlan",entityId:updated.id,newValue:{
   sourceId:source.id,sourceType:"RECURRING_EXPENSE",
   previousVersion:existing.version,currentVersion:updated.version,
   changedAmountCents:updated.amountCents,active:source.active}}});
}
export async function getBudgetPlanning(userId:string,asOf=businessDateKey(new Date())){
 date(asOf);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const settings=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  const snap=await budgetSnapshotInTx(tx,asOf);
  const horizon=businessDateKey(addBusinessDays(date(asOf),settings.budgetPlanningHorizonDays));
  const [targets,plans,moves,recurringSources,taxPeriods,recentChanges]=await Promise.all([
   tx.budgetTarget.findMany({where:{active:true},take:500}),
   tx.budgetCostPlan.findMany({where:{active:true},include:{
    occurrences:{where:{dueOn:{lte:date(horizon)},status:{not:"CANCELLED"}},
     orderBy:{dueOn:"asc"},include:{settlements:true},take:500},
    envelope:{select:{id:true,name:true}}},orderBy:{dueOn:"asc"},take:500}),
   tx.budgetMove.findMany({where:{kind:{in:["SPEND","REFUND","REVERSAL"]},sourceType:"JOURNAL_LINE"},
    select:{envelopeId:true,signedCents:true,kind:true,sourceId:true},take:5001}),
   tx.recurringExpense.findMany({where:{active:true},select:{id:true,name:true,amountCents:true,dayOfMonth:true},take:300}),
   tx.taxFilingPeriod.findMany({where:{status:"OPEN",dueOn:{gte:date(asOf),lte:date(horizon)}},
    include:{filingAccount:{select:{name:true}}},take:200}),
   tx.auditLog.findMany({where:{action:{startsWith:"budget."}},orderBy:{createdAt:"desc"},take:12,
    select:{id:true,action:true,createdAt:true,entityType:true}})
  ]);
  // Categorize net booked spending by the K journal source's Colorado date,
  // not the day the owner happened to classify or correct an expense.
  const sourceWarnings:string[]=[];
  if(moves.length>5000)sourceWarnings.push("Spending history exceeded the bounded source window; monthly target needs may be incomplete.");
  const bankJournalIds=[...new Set(moves.map(x=>x.sourceId).filter((x):x is string=>Boolean(x)))];
  const sourceLines=await tx.journalLine.findMany({where:{id:{in:bankJournalIds}},
   select:{id:true,entry:{select:{entryDate:true}}},take:5001});
  const lineDate=new Map(sourceLines.map(x=>[x.id,businessDateKey(x.entry.entryDate)]));
  const spent=new Map<string,number>();
  for(const move of moves.slice(0,5000)){
   const bookDay=move.sourceId?lineDate.get(move.sourceId):null;
   if(bookDay?.slice(0,7)!==asOf.slice(0,7))continue;
   spent.set(move.envelopeId,(spent.get(move.envelopeId)??0)-move.signedCents);
  }
  const expenseSources=[...new Set(plans.flatMap(p=>p.occurrences.flatMap(o=>
   o.settlements.filter(s=>s.sourceType==="EXPENSE").map(s=>s.sourceId))))];
  const sourceExpenses=await tx.expense.findMany({where:{id:{in:expenseSources}},
   select:{id:true,status:true},take:5001});
  const paymentStatus=new Map(sourceExpenses.map(e=>[e.id,e.status]));
  const upcoming=plans.flatMap(plan=>plan.occurrences.map(occ=>{
   const reversed=new Set(occ.settlements.flatMap(x=>x.reversalOfId?[x.reversalOfId]:[]));
   const originals=occ.settlements.filter(s=>s.reversalOfId===null&&!reversed.has(s.id));
   const unverified=originals.filter(s=>s.sourceType!=="EXPENSE"||
    paymentStatus.get(s.sourceId)!=="POSTED");
   if(unverified.length)sourceWarnings.push("A linked bill has voided or unavailable payment evidence; correct the planning link in Budget before relying on a paid status.");
   const paidCents=originals.filter(x=>x.sourceType==="EXPENSE"&&
    paymentStatus.get(x.sourceId)==="POSTED").reduce((sum,s)=>sum+s.amountCents,0);
   return {id:occ.id,planId:plan.id,envelopeId:plan.envelopeId,
    envelopeName:plan.envelope.name,name:plan.name,
    dueOn:businessDateKey(occ.dueOn),amountCents:occ.amountCents,
    paidCents,unpaidCents:Math.max(0,occ.amountCents-paidCents),
    quality:plan.amountQuality,status:unverified.length?"REVIEW_REQUIRED":occ.status,
    settlements:originals.map(s=>({id:s.id,amountCents:s.amountCents,sourceId:s.sourceId})),sourceType:plan.sourceType,
    sourceId:plan.sourceId,version:occ.version};
  }));
  const targetByEnvelope=new Map(targets.map(x=>[x.envelopeId,x]));
  const targetCycleWarnings=targets.filter(x=>x.kind==="SAVE_BY_DATE"&&!x.dueOn)
   .map(x=>"Savings target "+x.id+" has no valid due date; owner must review.");
  sourceWarnings.push(...targetCycleWarnings);
  const rows=snap.envelopes.map(env=>{
   const target=targetByEnvelope.get(env.id);
   const calculation=target?suggestedTarget({
    kind:target.kind as BudgetTargetKind,amountCents:target.amountCents,
    balanceCents:env.balanceCents,netSpentThisMonthCents:spent.get(env.id)??0,
    today:asOf,dueOn:target.dueOn?businessDateKey(target.dueOn):null,
    repeat:target.repeat as "NONE"|"ANNUAL"}):null;
   const bills=upcoming.filter(x=>x.envelopeId===env.id&&x.unpaidCents>0);
   const unpaidUpcomingCents=bills.filter(x=>x.dueOn<=businessDateKey(addBusinessDays(date(asOf),
    settings.budgetUpcomingWindowDays))).reduce((sum,x)=>sum+x.unpaidCents,0);
   const needCents=fundNowNeed({balanceCents:env.balanceCents,
    targetNeedCents:calculation?.neededCents??0,unpaidUpcomingCents});
   return {...env,target:target?{id:target.id,kind:target.kind,
    version:target.version,amountCents:target.amountCents,dueOn:target.dueOn?
    businessDateKey(target.dueOn):null,repeat:target.repeat}:null,
    monthlySuggestionCents:calculation?.suggestedPerMonthCents??0,
    nextGoalDueOn:calculation?.nextDueOn??null,
    spentThisMonthCents:spent.get(env.id)??0,unpaidUpcomingCents,needCents};
  });
  const candidates:BudgetFundCandidate[]=rows.filter(x=>x.active&&x.needCents>0).map(x=>({
   id:x.id,currentCents:x.balanceCents,needCents:x.needCents,
   priority:x.balanceCents<0?"NEGATIVE":x.unpaidUpcomingCents>0?"BILL":
    x.target?.kind==="SAVE_BY_DATE"?"SAVE_BY_DATE":
    x.target?.kind==="MONTHLY_SPEND"?"MONTHLY_SPEND":"MAINTAIN_BALANCE",
   dueOn:upcoming.find(row=>row.envelopeId===x.id&&row.unpaidCents>0)?.dueOn??x.nextGoalDueOn,
   sortOrder:x.sortOrder}));
  const proposal=fundingSuggestion(candidates,snap.mayAssign?snap.readyCents:null);
  return {asOf,through:horizon,revision:snap.stateRevision,sourceHash:snap.sourceHash,
   sourceStatus:snap.status,mayAssign:snap.mayAssign,
   sourceReasons:[...snap.reasons,...sourceWarnings],
   readyCents:snap.readyCents,protectedCents:snap.protectedTotalCents,
   envelopes:rows,upcoming,proposal,recurringSources,
   recentChanges:recentChanges.map(x=>({...x,createdAt:x.createdAt.toISOString()})),
   taxPeriods:taxPeriods.map(x=>({id:x.id,name:x.filingAccount.name,dueOn:businessDateKey(x.dueOn),status:x.status})),
   plans:plans.map(p=>({
    id:p.id,envelopeId:p.envelopeId,name:p.name,amountCents:p.amountCents,
    amountQuality:p.amountQuality,dueOn:businessDateKey(p.dueOn),
    recurrence:p.recurrence,active:p.active,version:p.version,
    sourceType:p.sourceType,sourceId:p.sourceId}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
