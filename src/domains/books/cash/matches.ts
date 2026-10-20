import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";

type Tx=Prisma.TransactionClient;
const signed=(x:{debitCents:number;creditCents:number})=>x.debitCents-x.creditCents;
const days=(d:Date)=>Date.parse(businessDateKey(d)+"T00:00:00Z")/86400000;
function selections(v:string[],label:string){
 if(!Array.isArray(v)||!v.length||v.length>50||new Set(v).size!==v.length||
  v.some(x=>typeof x!=="string"||x.length<4||x.length>180))
  throw new CashEvidenceError("Select 1–50 distinct "+label+".");
 return [...v].sort();
}
async function lockAccount(tx:Tx,id:string){
 await tx.$queryRawUnsafe('SELECT "id" FROM "CashAccount" WHERE "id"=$1 FOR UPDATE',id);
 const bank=await tx.cashAccount.findUnique({where:{id}});
 if(!bank?.active||bank.currency!=="USD")throw new CashEvidenceError("Active registered USD bank required.");
 return bank;
}
async function completed(tx:Tx,id:string,dates:Date[]){
 if(!dates.length)return false;
 return !!await tx.bankReconciliation.count({where:{cashAccountId:id,isCurrent:true,status:"COMPLETED",
  fromOn:{lte:new Date(Math.max(...dates.map(d=>d.getTime())))},
  toOn:{gte:new Date(Math.min(...dates.map(d=>d.getTime())))}}});
}
export async function getBankMatchDesk(userId:string,accountId:string){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const bank=await tx.cashAccount.findUnique({where:{id:accountId}});
  if(!bank?.active)throw new CashEvidenceError("Account not found.");
  const observations=await tx.bankObservation.findMany({where:{cashAccountId:accountId,isActive:true},
   orderBy:[{postedOn:"desc"},{id:"asc"}],take:100,
   select:{id:true,postedOn:true,signedCents:true,status:true,version:true,description:true,
    ignoreReason:true,matchItems:{where:{active:true},select:{groupId:true}}}});
  const lines=await tx.journalLine.findMany({where:{ledgerAccountId:bank.ledgerAccountId,
   bankMatchItems:{none:{active:true}}},orderBy:{entry:{entryDate:"desc"}},take:500,
   select:{id:true,debitCents:true,creditCents:true,
    entry:{select:{entryDate:true,entryNumber:true,eventKind:true,sourceType:true}}}});
  const suggestions=observations.filter(x=>x.status==="UNMATCHED").map(o=>({
   observationId:o.id,candidates:lines.filter(l=>signed(l)===o.signedCents&&
    Math.abs(days(l.entry.entryDate)-days(o.postedOn))<=bank.bankMatchWindowDays)
    .slice(0,10).map(l=>({id:l.id,entryNumber:l.entry.entryNumber,date:businessDateKey(l.entry.entryDate),
     amountCents:signed(l),source:l.entry.sourceType}))}));
  const groups=await tx.bankMatchGroup.findMany({where:{cashAccountId:accountId},
   orderBy:{createdAt:"desc"},take:40,include:{items:true}});
  const statements=await tx.bankReconciliation.findMany({where:{cashAccountId:accountId},
   orderBy:[{toOn:"desc"},{revisionNo:"desc"}],take:40});
  return {bank:{id:bank.id,name:bank.name,matchDays:bank.bankMatchWindowDays},
   observations,lines:lines.slice(0,100),suggestions,groups,statements};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
export async function confirmBankMatch(userId:string,input:{
 accountId:string;observationIds:string[];journalLineIds:string[];commandKey:string;
 observationVersions?:Record<string,number>;
}){
 const obsIds=selections(input.observationIds,"bank rows");
 const lineIds=selections(input.journalLineIds,"journal lines");
 if(!/^[A-Za-z0-9_-]{10,120}$/.test(input.commandKey))
  throw new CashEvidenceError("Safe match command key required.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const bank=await lockAccount(tx,input.accountId);
  const existing=await tx.bankMatchGroup.findUnique({where:{key:input.commandKey},include:{items:true}});
  if(existing){
   const a=existing.items.flatMap(x=>x.bankObservationId?[x.bankObservationId]:[]).sort();
   const b=existing.items.flatMap(x=>x.journalLineId?[x.journalLineId]:[]).sort();
   if(existing.voidedAt||existing.cashAccountId!==bank.id||
    JSON.stringify(a)!==JSON.stringify(obsIds)||JSON.stringify(b)!==JSON.stringify(lineIds))
    throw new CashEvidenceError("A different/voided match already used this command.");
   return existing.id;
  }
  for(const id of obsIds)
   await tx.$queryRawUnsafe('SELECT "id" FROM "BankObservation" WHERE "id"=$1 FOR UPDATE',id);
  for(const id of lineIds)
   await tx.$queryRawUnsafe('SELECT "id" FROM "JournalLine" WHERE "id"=$1 FOR UPDATE',id);
  const obs=await tx.bankObservation.findMany({where:{id:{in:obsIds},cashAccountId:bank.id,
   isActive:true,status:"UNMATCHED"},include:{matchItems:{where:{active:true}}}});
  const lines=await tx.journalLine.findMany({where:{id:{in:lineIds},ledgerAccountId:bank.ledgerAccountId},
   include:{bankMatchItems:{where:{active:true}}}});
  if(obs.length!==obsIds.length||lines.length!==lineIds.length||
   obs.some(x=>x.matchItems.length||(input.observationVersions&&input.observationVersions[x.id]!==x.version))||
   lines.some(x=>x.bankMatchItems.length))
   throw new CashEvidenceError("Stale/claimed source evidence; refresh.");
  const amount=obs.reduce((s,x)=>s+x.signedCents,0);
  const components=[...obs.map(x=>x.signedCents),...lines.map(signed)];
  if(!Number.isSafeInteger(amount)||amount===0||lines.reduce((s,x)=>s+signed(x),0)!==amount||
    components.some(x=>!Number.isSafeInteger(x)||x===0||Math.sign(x)!==Math.sign(amount)))
   throw new CashEvidenceError("Same-account match requires exact signed amounts in one direction.");
  if(obs.some(o=>lines.every(l=>Math.abs(days(o.postedOn)-days(l.entry.entryDate))>bank.bankMatchWindowDays)))
   throw new CashEvidenceError("Confirmed matches must fall inside the saved bank match window.");
  if(await completed(tx,bank.id,obs.map(x=>x.postedOn)))
   throw new CashEvidenceError("Reopen the completed statement before changing its match.");
  const group=await tx.bankMatchGroup.create({data:{cashAccountId:bank.id,
   key:input.commandKey,createdByUserId:userId,items:{create:[
    ...obs.map(x=>({bankObservationId:x.id,signedCents:x.signedCents})),
    ...lines.map(x=>({journalLineId:x.id,signedCents:signed(x)}))]}}});
  await tx.bankObservation.updateMany({where:{id:{in:obsIds}},
   data:{status:"MATCHED",version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.bank.match.confirm",
   entityType:"BankMatchGroup",entityId:group.id,newValue:{
    accountId:bank.id,observationIds:obsIds,journalLineIds:lineIds,totalCents:amount}}});
  return group.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function voidBankMatch(userId:string,groupId:string,version:number,reason:string){
 const why=reason.trim();
 if(!why||why.length>300)throw new CashEvidenceError("A correction reason is required.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const old=await tx.bankMatchGroup.findUnique({where:{id:groupId}});
  if(!old)throw new CashEvidenceError("Match not found.");
  await lockAccount(tx,old.cashAccountId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BankMatchGroup" WHERE "id"=$1 FOR UPDATE',groupId);
  const group=await tx.bankMatchGroup.findUnique({where:{id:groupId},
   include:{items:{include:{observation:true}}}});
  if(!group||group.version!==version||group.voidedAt)
   throw new CashEvidenceError("Match already changed.");
  if(await completed(tx,group.cashAccountId,
   group.items.flatMap(x=>x.observation?[x.observation.postedOn]:[])))
   throw new CashEvidenceError("Reopen the completed statement before voiding.");
  const obsIds=group.items.flatMap(x=>x.bankObservationId?[x.bankObservationId]:[]).sort();
  for(const id of obsIds)
   await tx.$queryRawUnsafe('SELECT "id" FROM "BankObservation" WHERE "id"=$1 FOR UPDATE',id);
  await tx.bankMatchItem.updateMany({where:{groupId,active:true},data:{active:false}});
  await tx.bankObservation.updateMany({where:{id:{in:obsIds},isActive:true},
   data:{status:"UNMATCHED",version:{increment:1}}});
  await tx.bankMatchGroup.update({where:{id:groupId},data:{
   voidedAt:new Date(),voidedByUserId:userId,voidedReason:why,version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.bank.match.void",
   entityType:"BankMatchGroup",entityId:groupId,newValue:{reason:why,observations:obsIds}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function ignoreBankObservation(userId:string,id:string,version:number,
 kind:"DUPLICATE"|"NON_ACCOUNT",reason:string){
 if(!["DUPLICATE","NON_ACCOUNT"].includes(kind)||!reason.trim()||reason.length>250)
  throw new CashEvidenceError("Choose duplicate/non-account and explain why.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  const old=await tx.bankObservation.findUnique({where:{id}});
  if(!old)throw new CashEvidenceError("Bank item not found.");
  await lockAccount(tx,old.cashAccountId);
  await tx.$queryRawUnsafe('SELECT "id" FROM "BankObservation" WHERE "id"=$1 FOR UPDATE',id);
  const item=await tx.bankObservation.findUnique({where:{id},
   include:{matchItems:{where:{active:true}}}});
  if(!item?.isActive||item.version!==version||item.status!=="UNMATCHED"||
    item.matchItems.length||await completed(tx,item.cashAccountId,[item.postedOn]))
   throw new CashEvidenceError("Matched, stale or completed rows cannot be ignored.");
  await tx.bankObservation.update({where:{id},data:{
   status:"IGNORED",ignoreReason:kind+": "+reason.trim(),version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.bank.observation.ignore",
   entityType:"BankObservation",entityId:id,newValue:{kind,reason:reason.trim()}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
