import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { plannedDueKeys,suggestedTarget,type BudgetTargetKind } from "./planning-math";
import { monthKey,rangeOfMonth,coloradoDay,sha256,safeAdd,safeCents,
 BudgetReportError,type MonthKey } from "./report-math";
import { checkedPublished,reportMonthInTx,type PublishedPayload,type PublishedRow } from "./reports";

type Tx=Prisma.TransactionClient;
const LIMIT=500;
const command=(key:string)=>{
 if(!/^[a-zA-Z0-9_-]{10,120}$/.test(key))throw new BudgetReportError("Use a unique safe publish operation identity.");
 return key;
};
const note=(text:string)=>{
 const value=text.trim();
 if(value.length<12||value.length>500||/[\u0000-\u001f]/.test(value))
  throw new BudgetReportError("Explain the monthly budget review (12–500 characters).");
 return value;
};
const revision=(value:string)=>{
 if(!/^\d{1,20}$/.test(value))throw new BudgetReportError("Budget revision missing; refresh the preview.");
 return BigInt(value);
};
async function locks(tx:Tx){
 await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
 await tx.$queryRawUnsafe('SELECT "id" FROM "BooksPostingRevision" WHERE "id"=$1 FOR UPDATE',"singleton");
}
async function draftInTx(tx:Tx,month:MonthKey){
 monthKey(month);
 const {from,to}=rangeOfMonth(month);
 const [state,books,envelopes,plans,targets,moves]=await Promise.all([
  tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
  tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
  tx.budgetEnvelope.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{id:"asc"}],take:LIMIT+1}),
  tx.budgetCostPlan.findMany({where:{active:true},select:{
   id:true,envelopeId:true,amountCents:true,amountQuality:true,dueOn:true,recurrence:true,
   occurrences:{where:{dueOn:{gte:coloradoDay(from),lte:coloradoDay(to)},status:{not:"CANCELLED"}},
     select:{id:true,dueOn:true,amountCents:true},take:LIMIT+1},
  },take:LIMIT+1}),
  tx.budgetTarget.findMany({where:{active:true},take:LIMIT+1}),
  tx.budgetMove.findMany({where:{createdAt:{lt:coloradoDay(from)}},select:{
   envelopeId:true,signedCents:true},take:10001}),
 ]);
 if(envelopes.length>LIMIT||plans.length>LIMIT||targets.length>LIMIT||moves.length>10000||
  plans.some(p=>p.occurrences.length>LIMIT))
  throw new BudgetReportError("Too many cost/target/funding sources for one verified plan.");
 const balances=new Map<string,number>();
 for(const move of moves)balances.set(move.envelopeId,safeAdd(balances.get(move.envelopeId)??0,move.signedCents));
 const warn:string[]=[];
 const rows:PublishedRow[]=envelopes.map(envelope=>{
  const sources=plans.filter(p=>p.envelopeId===envelope.id);
  const occ=sources.flatMap(p=>{
   if(p.occurrences.length) return p.occurrences.map(o=>({id:o.id,cents:o.amountCents,quality:p.amountQuality}));
   const anchor=businessDateKey(p.dueOn);
   const keys=plannedDueKeys({anchor,recurrence:p.recurrence as "NONE"|"MONTHLY"|"QUARTERLY"|"ANNUAL",
    from,to});
   if(keys.length)warn.push("Planned due costs without materialized monthly occurrence for "+envelope.name+"; verify source details.");
   return keys.map(day=>({id:p.id+":"+day,cents:p.amountCents,quality:p.amountQuality}));
  });
  const spend=occ.reduce((s,x)=>safeAdd(s,safeCents(x.cents,"planned due cost")),0);
  const opening=balances.get(envelope.id)??0;
  const target=targets.find(t=>t.envelopeId===envelope.id);
  let funding=0;
  if(target){
   const suggestion=suggestedTarget({kind:target.kind as BudgetTargetKind,
    amountCents:target.amountCents,balanceCents:opening,netSpentThisMonthCents:0,
    today:from,dueOn:target.dueOn?businessDateKey(target.dueOn):null,
    repeat:target.repeat as "NONE"|"ANNUAL"});
   funding=Math.max(0,suggestion.suggestedPerMonthCents);
  }
  return {envelopeId:envelope.id,name:envelope.name,groupLabel:envelope.groupLabel,
   openingSavedCents:opening,plannedSpendCents:spend,plannedFundCents:funding,
   amountQuality:occ.some(x=>x.quality!=="EXACT")?"ESTIMATE":"EXACT",
   sourceOccurrenceIds:[...new Set(occ.map(x=>x.id))].sort(),targetId:target?.id??null};
 });
 const seed={month,rows,sourceWarnings:warn,sourceBudgetRevision:state.revision.toString(),
  sourceBookRevision:books.revision.toString()};
 return {...seed,draftHash:sha256(seed)};
}
export async function previewMonthlyBudget(userId:string,month:string){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const draft=await draftInTx(tx,month);
  const latest=await tx.budgetPlanVersion.findFirst({where:{monthKey:month},
   orderBy:[{version:"desc"}],select:{id:true,version:true}});
  return {...draft,latest};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export type PublishBudgetInput={
 month:string;expectedBudgetRevision:string;expectedBookRevision:string;
 expectedVersion:number;draftHash:string;commandKey:string;note:string;
 confirmReviewed:boolean;rows:Array<{envelopeId:string;plannedSpendCents:number;
 plannedFundCents:number;amountQuality:"EXACT"|"ESTIMATE"|"OWNER_REVIEWED"}>;
};
export async function publishMonthlyBudget(userId:string,input:PublishBudgetInput){
 const month=monthKey(input.month),key=command(input.commandKey),why=note(input.note);
 if(!input.confirmReviewed||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||
  !/^[a-f0-9]{64}$/.test(input.draftHash)||!Array.isArray(input.rows)||input.rows.length>LIMIT)
  throw new BudgetReportError("Review every monthly amount, version and source preview before publishing.");
 const requested=input.rows.map(x=>{
  if(!x||typeof x.envelopeId!=="string"||!["EXACT","ESTIMATE","OWNER_REVIEWED"].includes(x.amountQuality))
   throw new BudgetReportError("Choose a reviewed plan quality and envelope.");
  return {envelopeId:x.envelopeId,plannedSpendCents:safeCents(x.plannedSpendCents,"planned spend"),
   plannedFundCents:safeCents(x.plannedFundCents,"planned funding"),amountQuality:x.amountQuality};
 }).sort((a,b)=>a.envelopeId.localeCompare(b.envelopeId));
 if(new Set(requested.map(x=>x.envelopeId)).size!==requested.length)
  throw new BudgetReportError("Each envelope must appear exactly once.");
 const requestHash=sha256({month,key,why,revision:input.expectedBudgetRevision,
  bookRevision:input.expectedBookRevision,version:input.expectedVersion,
  draftHash:input.draftHash,rows:requested,confirmed:input.confirmReviewed});
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await locks(tx);
  const repeat=await tx.budgetPlanVersion.findUnique({where:{commandKey:key}});
  if(repeat){
   const old=checkedPublished(repeat.payload);
   if(old.requestHash!==requestHash)throw new BudgetReportError("This operation key already published a different plan.");
   return {id:repeat.id,version:repeat.version,sha256:repeat.sha256,replayed:true};
  }
  const latest=await tx.budgetPlanVersion.findFirst({where:{monthKey:month},orderBy:{version:"desc"}});
  if((latest?.version??0)!==input.expectedVersion)
   throw new BudgetReportError("Another monthly version has been published; review again.");
  const draft=await draftInTx(tx,month);
  if(draft.sourceBudgetRevision!==revision(input.expectedBudgetRevision).toString()||
   draft.sourceBookRevision!==revision(input.expectedBookRevision).toString()||
   draft.draftHash!==input.draftHash)
   throw new BudgetReportError("Budget or Books sources changed since preview; review before publishing.");
  if(draft.rows.length!==requested.length||draft.rows.some(r=>!requested.some(x=>x.envelopeId===r.envelopeId)))
   throw new BudgetReportError("Envelope list changed since preview.");
  const values=draft.rows.map(row=>{
   const edited=requested.find(x=>x.envelopeId===row.envelopeId)!;
   const changed=edited.plannedSpendCents!==row.plannedSpendCents||
    edited.plannedFundCents!==row.plannedFundCents;
   if(changed&&edited.amountQuality!=="OWNER_REVIEWED")
    throw new BudgetReportError("Use Owner reviewed quality for manual cost/funding changes.");
   return {...row,...edited};
  });
  const payload:PublishedPayload={schemaVersion:1,monthKey:month,rows:values,
   sourceWarnings:draft.sourceWarnings,sourceBudgetRevision:draft.sourceBudgetRevision,
   sourceBookRevision:draft.sourceBookRevision,capturedAt:new Date().toISOString(),
   requestHash};
  checkedPublished(payload);
  const digest=sha256(payload);
  const current=await tx.budgetPlanVersion.create({data:{
   monthKey:month,version:input.expectedVersion+1,commandKey:key,publishedByUserId:userId,
   sourceRevision:revision(input.expectedBookRevision),budgetRevision:revision(input.expectedBudgetRevision),
   schemaVersion:1,payload:payload as unknown as Prisma.InputJsonValue,
   sha256:digest,note:why,supersedesId:latest?.id??null,
  }});
  await tx.auditLog.create({data:{userId,action:"budget.month.publish",
   entityType:"BudgetPlanVersion",entityId:current.id,newValue:{
   month,version:current.version,digest,requestHash,reason:why,supersedesId:latest?.id??null}}});
  return {id:current.id,version:current.version,sha256:current.sha256,replayed:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function getMonthlyPublishedVersions(userId:string,month:string){
 monthKey(month);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const records=await tx.budgetPlanVersion.findMany({where:{monthKey:month},
   orderBy:{version:"desc"},take:100});
  return records.map(x=>{
   if(sha256(x.payload)!==x.sha256)throw new BudgetReportError("Published plan content failed SHA-256 verification.");
   return {id:x.id,month:x.monthKey,version:x.version,publishedAt:x.publishedAt.toISOString(),
    note:x.note,sha256:x.sha256,payload:checkedPublished(x.payload)};
  });
 });
}
export async function saveMonthEndReview(userId:string,input:{
 month:string;planId?:string;commandKey:string;reason:string;confirmReviewed:boolean;
 expectedBudgetRevision:string;expectedBookRevision:string;
}){
 const month=monthKey(input.month),key=command(input.commandKey),reason=note(input.reason);
 if(!input.confirmReviewed)throw new BudgetReportError("Review the month-end checklist and open gaps first.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await locks(tx);
  const prior=await tx.budgetReviewSnapshot.findUnique({where:{commandKey:key}});
  if(prior){
   if(prior.monthKey!==month||prior.createdByUserId!==userId)
    throw new BudgetReportError("Another review already used this operation key.");
   if(sha256(prior.payload)!==prior.sha256)
    throw new BudgetReportError("Saved month-end review failed integrity check.");
   return {id:prior.id,sha256:prior.sha256,replayed:true};
  }
  const report=await reportMonthInTx(tx,{month,planId:input.planId,page:1,pageSize:25});
  if(report.budgetRevision!==revision(input.expectedBudgetRevision).toString()||
   report.sourceRevision!==revision(input.expectedBookRevision).toString())
   throw new BudgetReportError("Sources changed while reviewing month-end; refresh.");
  const payload={schemaVersion:1,month,reason,planId:report.published?.id??null,
   planVersion:report.published?.version??null,sourceRevision:report.sourceRevision,
   budgetRevision:report.budgetRevision,profit:report.profit,cash:report.cash,
   envelopes:report.envelopes,checklist:report.checklist,
   allMonthEndReady:report.allMonthEndReady,unclassifiedCents:report.unclassifiedCents,
   sourceCount:report.sourceCount,sourceReasons:report.sourceReasons,
   capturedAt:new Date().toISOString()};
  const digest=sha256(payload);
  const saved=await tx.budgetReviewSnapshot.create({data:{
   monthKey:month,commandKey:key,createdByUserId:userId,
   sourceRevision:revision(report.sourceRevision),budgetRevision:revision(report.budgetRevision),
   payload:payload as unknown as Prisma.InputJsonValue,schemaVersion:1,sha256:digest,
  }});
  await tx.auditLog.create({data:{userId,action:"budget.month.review",
   entityType:"BudgetReviewSnapshot",entityId:saved.id,
   newValue:{month,digest,planId:report.published?.id??null,
    incomplete:!report.allMonthEndReady,reason}}});
  return {id:saved.id,sha256:saved.sha256,replayed:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function getMonthEndReviews(userId:string,month:string){
 monthKey(month);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const [rev,book,history]=await Promise.all([
   tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
   tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
   tx.budgetReviewSnapshot.findMany({where:{monthKey:month},orderBy:{createdAt:"desc"},take:100}),
  ]);
  return history.map(r=>{
   if(sha256(r.payload)!==r.sha256)throw new BudgetReportError("Saved month-end review failed SHA-256 verification.");
   return {id:r.id,createdAt:r.createdAt.toISOString(),sha256:r.sha256,
    sourceRevision:r.sourceRevision.toString(),budgetRevision:r.budgetRevision.toString(),
    stale:r.sourceRevision!==book.revision||r.budgetRevision!==rev.revision,
    content:r.payload};
  });
 });
}

export async function getMonthEndReviewById(userId:string,id:string){
 if(!/^[a-zA-Z0-9_-]{8,150}$/.test(id))throw new BudgetReportError("Invalid review identifier.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const item=await tx.budgetReviewSnapshot.findUnique({where:{id}});
  if(!item)throw new BudgetReportError("This saved review is not available.");
  if(sha256(item.payload)!==item.sha256)
   throw new BudgetReportError("Saved month-end evidence failed its integrity check.");
  const [state,books]=await Promise.all([
   tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
   tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
  ]);
  const data=item.payload as unknown as {
   schemaVersion:number;reason:string;planVersion:number|null;
   profit:{revenueCents:number;costCents:number;netProfitCents:number};
   cash:{netCents:number|null};
   unclassifiedCents:number;
   checklist:{key:string;label:string;ok:boolean;reason:string|null}[];
   allMonthEndReady:boolean;
  };
  if(data.schemaVersion!==1||!Array.isArray(data.checklist))throw new BudgetReportError("Unknown archived review schema.");
  return {month:item.monthKey,createdAt:item.createdAt.toISOString(),sha256:item.sha256,
   stale:state.revision!==item.budgetRevision||books.revision!==item.sourceRevision,
   content:data};
 });
}
