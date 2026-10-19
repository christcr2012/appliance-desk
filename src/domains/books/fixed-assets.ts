import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { balancedPlan, depreciationAccrued } from "./posting-rules";
import { postForSource, writeJournal } from "./post";
import { BookAssetInputError, lastBusinessDay, lastCompletedMonth, monthKey, nextMonth, remainingSchedule } from "./depreciation";

type Tx=Prisma.TransactionClient;
type BookRole="OWNER"|"ADMIN";
const intents=["SELL","DECIDE_LATER","SCRAP","STRIP","DISPOSE","DONATE_OTHER"] as const;
const classifications=["UNKNOWN","RENTAL_ASSET","EXPENSED","INVENTORY","OTHER"] as const;
const confidence=["UNKNOWN","OWNER_SUPPLIED","CPA_CONFIRMED"] as const;
const text=(value:string,label:string,max:number)=>{
 const result=value.trim();
 if(!result||result.length>max)throw new BookAssetInputError(label+" is required and must fit "+max+" characters.");
 return result;
};
function dateInput(key:string):Date{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key))throw new BookAssetInputError("Choose an actual Colorado date.");
 const date=businessDateFromKey(key);
 if(!date||businessDateKey(date)!==key)throw new BookAssetInputError("Choose an actual Colorado date.");
 return date;
}
function bounded(value:number,min:number,max:number,label:string):number{
 if(!Number.isSafeInteger(value)||value<min||value>max)throw new BookAssetInputError(label+" is out of bounds.");
 return value;
}
const asMonth=(date:Date)=>businessDateKey(date).slice(0,7);
const countMonths=(first:string,lastExclusive:string)=>{
 const [y,m]=monthKey(first).split("-").map(Number),[Y,M]=monthKey(lastExclusive).split("-").map(Number);
 return (Y-y)*12+M-m;
};
async function actor(tx:Tx,id:string,roles:BookRole[]=["OWNER"]){
 return assertActiveTeamActor(tx,id,roles);
}
async function lockAsset(tx:Tx,id:string){
 await tx.$queryRaw`SELECT "applianceId" FROM "BookAsset" WHERE "applianceId"=${id} FOR UPDATE`;
 const row=await tx.bookAsset.findUnique({where:{applianceId:id}});
 if(!row)throw new BookAssetInputError("Enroll this appliance in Books first.");
 return row;
}
async function postedEvidence(tx:Tx,id:string){
 const rows=await tx.journalEntry.findMany({
  where:{sourceType:"APPLIANCE",sourceId:id,eventKind:{startsWith:"DEPRECIATION:"}},
  include:{lines:{include:{ledgerAccount:{select:{systemRole:true}}}}},
  orderBy:{eventKind:"asc"},take:361,
 });
 if(rows.length>360)throw new BookAssetInputError("Depreciation history needs review.");
 let total=0;
 for(const row of rows){
  const debit=row.lines.filter(l=>l.ledgerAccount.systemRole==="DEPRECIATION").reduce((sum,l)=>sum+l.debitCents,0);
  if(!Number.isSafeInteger(debit)||debit<0)throw new BookAssetInputError("Unbalanced depreciation evidence needs review.");
  total+=debit;
 }
 if(!Number.isSafeInteger(total))throw new BookAssetInputError("Depreciation history is too large.");
 return {total,months:rows.map(r=>r.eventKind.slice("DEPRECIATION:".length))};
}
async function verifyCapitalSource(tx:Tx,id:string) {
 await postForSource(tx,"APPLIANCE",id);
 const contribution=await tx.journalEntry.findUnique({where:{sourceType_sourceId_eventKind:{
  sourceType:"APPLIANCE",sourceId:id,eventKind:"APPLIANCE_CONTRIBUTED",
 }},select:{id:true}});
 if(contribution)return;
 const capitalized=await tx.expense.findMany({where:{
  applianceId:id,capitalizeToAppliance:true,status:"POSTED",
 },select:{id:true},take:10});
 if(!capitalized.length)throw new BookAssetInputError("No posted acquisition journal; reconcile this asset before depreciation.");
 const posted=await tx.journalEntry.findFirst({where:{
  sourceType:"EXPENSE",sourceId:{in:capitalized.map(x=>x.id)},eventKind:"EXPENSE_POSTED",
 },select:{id:true}});
 if(!posted)throw new BookAssetInputError("Capitalized expense journal missing; asset requires review.");
}
export async function enrollBookAsset(userId:string,applianceId:string,placedDateKey:string){
 const placed=dateInput(placedDateKey);
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id"=${applianceId} FOR UPDATE`;
  const appliance=await tx.appliance.findUnique({where:{id:applianceId},
   include:{applianceType:{select:{depreciationMonths:true}}}});
  const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{
   booksStartDate:true,depreciationMonthsDefault:true,depreciationSalvagePercent:true,
  }});
  if(!settings?.booksStartDate)throw new BookAssetInputError("Initialize your Books opening balances first.");
  if(placed<settings.booksStartDate||placed>new Date())
   throw new BookAssetInputError("Attest an in-service date on or after the Books start date and not in the future.");
  if(!appliance||!appliance.acquisitionCostCents||appliance.acquisitionCostCents<=0)
   throw new BookAssetInputError("This appliance needs a verified positive acquisition cost.");
  const cost=bounded(appliance.acquisitionCostCents,1,1_000_000_000,"Acquisition cost");
  const existing=await tx.bookAsset.findUnique({where:{applianceId}});
  if(existing){
   if(existing.costCents!==cost||existing.placedInServiceOn.getTime()!==placed.getTime())
    throw new BookAssetInputError("Original book asset evidence differs; reconcile before continuing.");
   return existing.applianceId;
  }
  const life=bounded(appliance.applianceType.depreciationMonths??settings.depreciationMonthsDefault,1,360,"Life months");
  const salvage=bounded(settings.depreciationSalvagePercent,0,95,"Salvage percentage");
  await tx.bookAsset.create({data:{
   applianceId,costCents:cost,placedInServiceOn:placed,lifeMonths:life,
   salvagePercent:salvage,createdByUserId:userId,
  }});
  await tx.auditLog.create({data:{userId,action:"books.asset.enroll",entityType:"BookAsset",
   entityId:applianceId,newValue:{costCents:cost,placedDateKey,lifeMonths:life,salvagePercent:salvage}}});
  return applianceId;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function setBookAssetPolicy(userId:string,id:string,expectedVersion:number,lifeMonths:number,salvagePercent:number){
 bounded(lifeMonths,1,360,"Book life");bounded(salvagePercent,0,95,"Book salvage");
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  const row=await lockAsset(tx,id);
  if(row.version!==expectedVersion||row.retiredOn)throw new BookAssetInputError("Asset changed or retired; refresh.");
  const history=await postedEvidence(tx,id);
  const first=nextMonth(asMonth(row.placedInServiceOn));
  const next=row.lastDepreciationMonth?nextMonth(row.lastDepreciationMonth):first;
  remainingSchedule({costCents:row.costCents,salvagePercent,months:lifeMonths,
   postedCents:history.total,postedMonths:countMonths(first,next),nextUnpostedMonth:next});
  await tx.bookAsset.update({where:{applianceId:id},data:{lifeMonths,salvagePercent,version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.asset.policy",entityType:"BookAsset",entityId:id,
   oldValue:{lifeMonths:row.lifeMonths,salvagePercent:row.salvagePercent},
   newValue:{lifeMonths,salvagePercent}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function setBookDepreciationDefaults(userId:string,months:number,salvagePercent:number){
 bounded(months,1,360,"Book life");bounded(salvagePercent,0,95,"Book salvage");
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  const old=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
   select:{depreciationMonthsDefault:true,depreciationSalvagePercent:true}});
  await tx.businessSettings.update({where:{id:"singleton"},data:{
   depreciationMonthsDefault:months,depreciationSalvagePercent:salvagePercent,
  }});
  await tx.auditLog.create({data:{userId,action:"books.asset.defaults",entityType:"BusinessSettings",
   entityId:"singleton",oldValue:old,newValue:{depreciationMonthsDefault:months,depreciationSalvagePercent:salvagePercent}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function postBookDepreciation(userId:string,id:string,throughMonth:string){
 monthKey(throughMonth);
 if(throughMonth>lastCompletedMonth())throw new BookAssetInputError("Only completed Colorado months may be depreciated.");
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  const asset=await lockAsset(tx,id);
  if(asset.retiredOn)throw new BookAssetInputError("Retired asset book value is frozen pending disposition.");
  const appliance=await tx.appliance.findUniqueOrThrow({where:{id}});
  if(appliance.acquisitionCostCents!==asset.costCents)
   throw new BookAssetInputError("Original acquisition cost changed; resolve before posting.");
  await verifyCapitalSource(tx,id);
  const history=await postedEvidence(tx,id);
  const first=nextMonth(asMonth(asset.placedInServiceOn));
  const next=asset.lastDepreciationMonth?nextMonth(asset.lastDepreciationMonth):first;
  const schedule=remainingSchedule({costCents:asset.costCents,salvagePercent:asset.salvagePercent,
   months:asset.lifeMonths,postedCents:history.total,
   postedMonths:countMonths(first,next),nextUnpostedMonth:next})
    .filter(r=>r.periodKey<=throughMonth).slice(0,12);
  let posted=0,last:string|null=null;
  for(const r of schedule){
   if(r.amountCents>0){
    const plan=depreciationAccrued({date:lastBusinessDay(r.periodKey),
     amountCents:r.amountCents,periodKey:r.periodKey});
    if(plan && await writeJournal(tx,"APPLIANCE",id,"DEPRECIATION:"+r.periodKey,plan,{applianceId:id}))posted++;
   }
   last=r.periodKey;
  }
  if(last){
   await tx.bookAsset.update({where:{applianceId:id},data:{lastDepreciationMonth:last,version:{increment:1}}});
   await tx.auditLog.create({data:{userId,action:"books.asset.depreciate",entityType:"BookAsset",entityId:id,
    newValue:{through:last,newJournalEntries:posted}}});
  }
  return {posted,lastCompleted:last};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function retireBookAsset(userId:string,id:string,expectedVersion:number,intent:string,retiredDateKey:string){
 if(!intents.some(x=>x===intent))throw new BookAssetInputError("Choose a supported retirement intent.");
 const retired=dateInput(retiredDateKey);
 if(retired>new Date())throw new BookAssetInputError("Retirement cannot be dated in the future.");
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  const asset=await lockAsset(tx,id);
  if(asset.version!==expectedVersion)throw new BookAssetInputError("Asset changed; refresh before retiring.");
  if(asset.retiredOn)throw new BookAssetInputError("Retirement is already documented; later sale belongs to M-2C.");
  if(retired<asset.placedInServiceOn)throw new BookAssetInputError("Retirement cannot precede service.");
  const appliance=await tx.appliance.findUniqueOrThrow({where:{id}});
  if(appliance.status!=="RETIRED")throw new BookAssetInputError("Remove the appliance from rentable service before book retirement.");
  if(appliance.acquisitionCostCents!==asset.costCents)throw new BookAssetInputError("Acquisition cost changed; owner review required.");
  const previous=await tx.journalEntry.findFirst({where:{
   sourceType:"APPLIANCE",sourceId:id,OR:[
    {eventKind:{contains:"RETIRED"}},{eventKind:{contains:"DISPOSED"}},{eventKind:{contains:"SOLD"}},
   ],
  },select:{eventKind:true}});
  if(previous)throw new BookAssetInputError("Historical asset retirement/disposition journal requires accountant reconciliation.");
  const first=nextMonth(asMonth(asset.placedInServiceOn));
  const finalMonth=asMonth(retired)<lastCompletedMonth()?asMonth(retired):lastCompletedMonth();
  if(first<=finalMonth && (!asset.lastDepreciationMonth||asset.lastDepreciationMonth<finalMonth))
   throw new BookAssetInputError("Post completed depreciation through retirement month before staging.");
  await verifyCapitalSource(tx,id);
  const history=await postedEvidence(tx,id);
  const carried=asset.costCents-history.total;
  if(!Number.isSafeInteger(carried)||carried<0)
   throw new BookAssetInputError("Book carrying value is invalid; reconcile first.");
  if(carried>0){
   const plan=balancedPlan(retired,"Retired rental appliance held pending final disposition",[
    {role:"RETIRED_PENDING_DISPOSITION",debitCents:carried,creditCents:0},
    {role:"RENTAL_EQUIPMENT",debitCents:0,creditCents:carried},
   ]);
   if(!plan||!await writeJournal(tx,"APPLIANCE",id,"RETIRED_HELD",plan,{applianceId:id}))
    throw new BookAssetInputError("Retired-asset transfer already exists; investigate.");
  }
  await tx.bookAsset.update({where:{applianceId:id},data:{
   retiredOn:retired,retirementIntent:intent,retiredValueCents:carried,version:{increment:1},
  }});
  await tx.auditLog.create({data:{userId,action:"books.asset.retire",entityType:"BookAsset",entityId:id,
   newValue:{intent,retiredDateKey,carriedCents:carried,notADisposalLoss:true}}});
  return {carriedCents:carried};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function addBookTaxEvidence(userId:string,id:string,input:{
 classification:string;confidence:string;originalBasisCents:number|null;signedAdjustmentsCents:number|null;
 allowedDepreciationCents:number|null;section179Cents:number|null;bonusDepreciationCents:number|null;
 evidenceDate:string;sourceReference:string;cpaName?:string;
}){
 if(!classifications.some(x=>x===input.classification)||!confidence.some(x=>x===input.confidence))
  throw new BookAssetInputError("Tax-basis classification or evidence confidence is invalid.");
 const asOf=dateInput(input.evidenceDate);
 if(asOf>new Date())throw new BookAssetInputError("Tax-basis evidence cannot be dated in the future.");
 for(const [label,value] of Object.entries({
  originalBasisCents:input.originalBasisCents,allowedDepreciationCents:input.allowedDepreciationCents,
  section179Cents:input.section179Cents,bonusDepreciationCents:input.bonusDepreciationCents,
 }))if(value!==null)bounded(value,0,1_000_000_000,label);
 if(input.signedAdjustmentsCents!==null && (!Number.isSafeInteger(input.signedAdjustmentsCents)||
   Math.abs(input.signedAdjustmentsCents)>1_000_000_000))
  throw new BookAssetInputError("Tax basis adjustments must be signed whole cents.");
 const reference=text(input.sourceReference,"Source reference",300);
 const cpa=input.cpaName?.trim()||null;
 if(input.confidence==="CPA_CONFIRMED" && (!cpa||!reference))
  throw new BookAssetInputError("CPA-confirmed evidence requires the named CPA and source reference.");
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  await lockAsset(tx,id);
  const row=await tx.bookTaxEvidence.create({data:{
   applianceId:id,classification:input.classification,confidence:input.confidence,
   originalBasisCents:input.originalBasisCents,signedAdjustmentsCents:input.signedAdjustmentsCents,
   allowedDepreciationCents:input.allowedDepreciationCents,section179Cents:input.section179Cents,
   bonusDepreciationCents:input.bonusDepreciationCents,evidenceAsOf:asOf,sourceReference:reference,
   cpaName:cpa,recordedByUserId:userId,
  }});
  await tx.auditLog.create({data:{userId,action:"books.asset.tax-evidence",entityType:"BookTaxEvidence",
   entityId:row.id,newValue:{applianceId:id,classification:input.classification,
    confidence:input.confidence,evidenceDate:input.evidenceDate,sourceReference:reference}}});
  return row.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function getBookAssets(userId:string) {
 return prisma.$transaction(async tx=>{
  await actor(tx,userId,["OWNER","ADMIN"]);
  const [settings,assets,candidates]=await Promise.all([
   tx.businessSettings.findUnique({where:{id:"singleton"},select:{
    booksStartDate:true,depreciationMonthsDefault:true,depreciationSalvagePercent:true,
   }}),
   tx.bookAsset.findMany({orderBy:{createdAt:"desc"},take:100,
    include:{appliance:{select:{assetNumber:true,status:true,acquisitionCostCents:true}},
     taxEvidence:{orderBy:{createdAt:"desc"},take:3}}},
   tx.appliance.findMany({where:{acquisitionCostCents:{gt:0},bookAsset:{is:null}},
    orderBy:{createdAt:"desc"},take:100,select:{id:true,assetNumber:true,acquisitionCostCents:true,purchaseDate:true}}),
  ]);
  const journal=await tx.journalEntry.findMany({where:{
   sourceType:"APPLIANCE",sourceId:{in:assets.map(x=>x.applianceId)},
   eventKind:{startsWith:"DEPRECIATION:"},
  },include:{lines:{include:{ledgerAccount:{select:{systemRole:true}}}}}});
  const byAsset=new Map<string,number>();
  for(const entry of journal){
   const cents=entry.lines.filter(l=>l.ledgerAccount.systemRole==="DEPRECIATION").reduce((sum,l)=>sum+l.debitCents,0);
   byAsset.set(entry.sourceId,(byAsset.get(entry.sourceId)??0)+cents);
  }
  return {settings,candidates,assets:assets.map(asset=>({
   ...asset,postedDepreciationCents:byAsset.get(asset.applianceId)??0,
   bookCarryingCents:asset.costCents-(byAsset.get(asset.applianceId)??0),
   isPendingDisposition:!!asset.retiredOn,
  }))};
 });
}
