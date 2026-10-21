import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey,businessDateKey } from "@/lib/business-date";
import { BudgetEvidenceError } from "./protected";

const limit=(s:string,n:number)=>s.trim().length>0&&s.trim().length<=n;
const supported=(n:number,a:number,b:number)=>Number.isInteger(n)&&n>=a&&n<=b;
export async function configureBudgetEnvelope(userId:string,input:{
 envelopeId:string;expectedVersion:number;name:string;groupLabel:string;sortOrder:number;
 active:boolean;reason:string;
}){
 const name=input.name.trim(),group=input.groupLabel.trim(),reason=input.reason.trim();
 if(!limit(name,120)||!limit(group,120)||!supported(input.sortOrder,-9999,9999)||
  !limit(reason,300)||reason.length<12||!supported(input.expectedVersion,1,2147483647))
  throw new BudgetEvidenceError("Provide a name, group, ordering, version and correction reason.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetEnvelope" WHERE "id"=$1 FOR UPDATE',input.envelopeId);
  const old=await tx.budgetEnvelope.findUnique({where:{id:input.envelopeId}});
  if(!old||old.version!==input.expectedVersion)throw new BudgetEvidenceError("Envelope changed; refresh.");
  if(!input.active&&old.active){
   const balance=await tx.budgetMove.aggregate({where:{envelopeId:old.id},_sum:{signedCents:true}});
   if((balance._sum.signedCents??0)!==0)
    throw new BudgetEvidenceError("Release or review all remaining envelope funding before archiving; balances are never deleted.");
  }
  const updated=await tx.budgetEnvelope.update({where:{id:old.id},data:{
   name,groupLabel:group,sortOrder:input.sortOrder,active:input.active,
   version:{increment:1}}});
  await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.envelope.configure",
   entityType:"BudgetEnvelope",entityId:old.id,newValue:{
    previous:{name:old.name,groupLabel:old.groupLabel,sortOrder:old.sortOrder,
     active:old.active,version:old.version},current:{
     name,groupLabel:group,sortOrder:input.sortOrder,active:input.active,
     version:updated.version},reason}}});
  return updated.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function configureBudgetWindows(userId:string,input:{
 bankEvidenceMaxAgeDays:number;budgetPlanningHorizonDays:number;
 budgetUpcomingWindowDays:number;budgetReminderLeadDays:number;reason:string;
 expectedRevision:string;
}){
 if(!supported(input.bankEvidenceMaxAgeDays,1,90)||
 !supported(input.budgetPlanningHorizonDays,30,365)||
 !supported(input.budgetUpcomingWindowDays,1,90)||
 !supported(input.budgetReminderLeadDays,0,90)||
 !/^\d+$/.test(input.expectedRevision)||input.reason.trim().length<12||
 input.reason.length>300)
  throw new BudgetEvidenceError("Use valid review windows and explain the owner decision.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BudgetState" WHERE "id"=$1 FOR UPDATE',"singleton");
  const state=await tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}});
  if(state.revision.toString()!==input.expectedRevision)
   throw new BudgetEvidenceError("Budget settings changed. Refresh before editing.");
  const prior=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
   select:{bankEvidenceMaxAgeDays:true,budgetPlanningHorizonDays:true,
    budgetUpcomingWindowDays:true,budgetReminderLeadDays:true}});
  const current={bankEvidenceMaxAgeDays:input.bankEvidenceMaxAgeDays,
   budgetPlanningHorizonDays:input.budgetPlanningHorizonDays,
   budgetUpcomingWindowDays:input.budgetUpcomingWindowDays,
   budgetReminderLeadDays:input.budgetReminderLeadDays};
  await tx.businessSettings.update({where:{id:"singleton"},data:current});
  await tx.budgetState.update({where:{id:"singleton"},data:{revision:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"budget.settings.windows",
   entityType:"BudgetState",entityId:"singleton",newValue:{prior,current,
    reason:input.reason.trim()}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function getBudgetWindows(userId:string){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const settings=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
   select:{bankEvidenceMaxAgeDays:true,budgetPlanningHorizonDays:true,
    budgetUpcomingWindowDays:true,budgetReminderLeadDays:true}});
  return settings;
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
