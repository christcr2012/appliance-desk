import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { balancedPlan, depreciationAccrued } from "./posting-rules";
import { postForSource, writeJournal } from "./post";
import { assertBooksWriter, booksAuditActor, type BooksWriter } from "./actor";
import { BookAssetInputError, lastBusinessDay, lastCompletedMonth, monthKey, monthlySchedule, nextMonth, remainingSchedule } from "./depreciation";

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
/** Called by the owner flow or a trusted background book run. Caller owns the transaction. */
export async function enrollBookAssetInTx(
 tx:Tx,writer:BooksWriter,applianceId:string,placedDateKey:string,source:"MANUAL"|"AUTOMATIC"
):Promise<string>{
 const placed=dateInput(placedDateKey);
 await assertBooksWriter(tx,writer);
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
 if(appliance.status==="RETIRED"&&source==="AUTOMATIC")
  throw new BookAssetInputError("Retired appliances are not enrolled automatically.");
 const cost=bounded(appliance.acquisitionCostCents,1,1_000_000_000,"Acquisition cost");
 const existing=await tx.bookAsset.findUnique({where:{applianceId}});
 if(existing){
  if(existing.costCents!==cost||existing.placedInServiceOn.getTime()!==placed.getTime())
   throw new BookAssetInputError("Original book asset evidence differs; reconcile before continuing.");
  return existing.applianceId;
 }
 if(source==="AUTOMATIC")await verifyCapitalSource(tx,applianceId);
 const life=bounded(appliance.applianceType.depreciationMonths??settings.depreciationMonthsDefault,1,360,"Life months");
 const salvage=bounded(settings.depreciationSalvagePercent,0,95,"Salvage percentage");
 const audit=booksAuditActor(writer);
 await tx.bookAsset.create({data:{
  applianceId,costCents:cost,placedInServiceOn:placed,lifeMonths:life,
  salvagePercent:salvage,createdByUserId:audit.userId,enrollmentSource:source,
 }});
 await tx.auditLog.create({data:{userId:audit.userId,action:"books.asset.enroll",entityType:"BookAsset",
  entityId:applianceId,newValue:{costCents:cost,placedDateKey,lifeMonths:life,salvagePercent:salvage,by:audit.by}}});
 return applianceId;
}
export async function enrollBookAsset(userId:string,applianceId:string,placedDateKey:string){
 return prisma.$transaction(tx=>enrollBookAssetInTx(tx,{kind:"person",userId},applianceId,placedDateKey,"MANUAL"),
  {isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
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
  await tx.bookAsset.update({where:{applianceId:id},data:{lifeMonths,salvagePercent,fullyDepreciatedOn:null,version:{increment:1}}});
  await tx.auditLog.create({data:{userId,action:"books.asset.policy",entityType:"BookAsset",entityId:id,
   oldValue:{lifeMonths:row.lifeMonths,salvagePercent:row.salvagePercent},
   newValue:{lifeMonths,salvagePercent}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function setBookDepreciationDefaults(userId:string,months:number,salvagePercent:number){
 bounded(months,1,360,"Book life");bounded(salvagePercent,0,95,"Book salvage");
 return prisma.$transaction(async tx=>{
  await actor(tx,userId);
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id"=${"singleton"} FOR UPDATE`;
  const old=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
   select:{depreciationMonthsDefault:true,depreciationSalvagePercent:true}});
  await tx.businessSettings.update({where:{id:"singleton"},data:{
   depreciationMonthsDefault:months,depreciationSalvagePercent:salvagePercent,
  }});
  await tx.auditLog.create({data:{userId,action:"books.asset.defaults",entityType:"BusinessSettings",
   entityId:"singleton",oldValue:old,newValue:{depreciationMonthsDefault:months,depreciationSalvagePercent:salvagePercent}}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
/** Months are capped for manual use; nightly catch-up may process the full 360-month schedule. */
export async function postBookDepreciationInTx(
 tx:Tx,writer:BooksWriter,id:string,throughMonth:string,options:{maxMonths:number}
):Promise<{posted:number;lastCompleted:string|null}>{
 monthKey(throughMonth);
 if(throughMonth>lastCompletedMonth())throw new BookAssetInputError("Only completed Colorado months may be depreciated.");
 bounded(options.maxMonths,1,360,"Depreciation month limit");
 await assertBooksWriter(tx,writer);
 const asset=await lockAsset(tx,id);
 if(asset.retiredOn)throw new BookAssetInputError("Retired asset book value is frozen pending disposition.");
 const appliance=await tx.appliance.findUniqueOrThrow({where:{id}});
 if(appliance.acquisitionCostCents!==asset.costCents)
  throw new BookAssetInputError("Original acquisition cost changed; resolve before posting.");
 await verifyCapitalSource(tx,id);
 const history=await postedEvidence(tx,id);
 const first=nextMonth(asMonth(asset.placedInServiceOn));
 const next=asset.lastDepreciationMonth?nextMonth(asset.lastDepreciationMonth):first;
 const all=remainingSchedule({costCents:asset.costCents,salvagePercent:asset.salvagePercent,
  months:asset.lifeMonths,postedCents:history.total,
  postedMonths:countMonths(first,next),nextUnpostedMonth:next});
 const schedule=all.filter(r=>r.periodKey<=throughMonth).slice(0,options.maxMonths);
 let posted=0,last:string|null=null;
 for(const r of schedule){
  if(r.amountCents>0){
   const plan=depreciationAccrued({date:lastBusinessDay(r.periodKey),
    amountCents:r.amountCents,periodKey:r.periodKey});
   if(plan && await writeJournal(tx,"APPLIANCE",id,"DEPRECIATION:"+r.periodKey,plan,{applianceId:id}))posted++;
  }
  last=r.periodKey;
 }
 const audit=booksAuditActor(writer);
 if(last){
  const exhausted=schedule.length===all.length;
  await tx.bookAsset.update({where:{applianceId:id},data:{
   lastDepreciationMonth:last,fullyDepreciatedOn:exhausted?lastBusinessDay(last):null,version:{increment:1},
  }});
  await tx.auditLog.create({data:{userId:audit.userId,action:"books.asset.depreciate",entityType:"BookAsset",entityId:id,
   newValue:{through:last,newJournalEntries:posted,by:audit.by}}});
 }else if(!all.length&&!asset.fullyDepreciatedOn){
  await tx.bookAsset.update({where:{applianceId:id},data:{fullyDepreciatedOn:new Date()}});
 }
 return {posted,lastCompleted:last};
}
export async function postBookDepreciation(userId:string,id:string,throughMonth:string){
 return prisma.$transaction(tx=>postBookDepreciationInTx(tx,{kind:"person",userId},id,throughMonth,{maxMonths:12}),
  {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function retireBookAssetInTx(
 tx:Tx,writer:BooksWriter,id:string,expectedVersion:number|null,intent:string,retiredDateKey:string
):Promise<{carriedCents:number}>{
 if(!intents.some(x=>x===intent))throw new BookAssetInputError("Choose a supported retirement intent.");
 const retired=dateInput(retiredDateKey);
 if(retired>new Date())throw new BookAssetInputError("Retirement cannot be dated in the future.");
 await assertBooksWriter(tx,writer);
 const asset=await lockAsset(tx,id);
 if(expectedVersion===null&&writer.kind!=="automatic")
  throw new BookAssetInputError("A person must check the asset version before retirement.");
 if(expectedVersion!==null&&asset.version!==expectedVersion)
  throw new BookAssetInputError("Asset changed; refresh before retiring.");
 if(asset.retiredOn)throw new BookAssetInputError("Retirement is already documented; later sale belongs to the shop.");
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
 const scheduledEnd=monthlySchedule({costCents:asset.costCents,months:asset.lifeMonths,
  salvagePercent:asset.salvagePercent,startMonth:first}).at(-1)!.periodKey;
 const retireMonth=asMonth(retired);
 const required=[retireMonth,lastCompletedMonth(),scheduledEnd].sort()[0]!;
 const history=await postedEvidence(tx,id);
 if((asset.lastDepreciationMonth&&asset.lastDepreciationMonth>retireMonth)||
    history.months.some(month=>month>retireMonth))
  throw new BookAssetInputError("Depreciation was recorded past retirement date; review before transferring book value.");
 if(first<=required&&(!asset.lastDepreciationMonth||asset.lastDepreciationMonth<required))
  throw new BookAssetInputError("Post completed scheduled depreciation before staging retirement.");
 await verifyCapitalSource(tx,id);
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
 const audit=booksAuditActor(writer);
 await tx.bookAsset.update({where:{applianceId:id},data:{
  retiredOn:retired,retirementIntent:intent,retiredValueCents:carried,version:{increment:1},
 }});
 await tx.auditLog.create({data:{userId:audit.userId,action:"books.asset.retire",entityType:"BookAsset",entityId:id,
  newValue:{intent,retiredDateKey,carriedCents:carried,notADisposalLoss:true,by:audit.by}}});
 return {carriedCents:carried};
}
export async function retireBookAsset(userId:string,id:string,expectedVersion:number,intent:string,retiredDateKey:string){
 return prisma.$transaction(tx=>retireBookAssetInTx(tx,{kind:"person",userId},id,expectedVersion,intent,retiredDateKey),
  {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
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
     taxEvidence:{orderBy:{createdAt:"desc"},take:3}}}),
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
   bookCarryingCents:asset.disposedOn?0:asset.costCents-(byAsset.get(asset.applianceId)??0),
   isPendingDisposition:!!asset.retiredOn&&!asset.disposedOn,
  }))};
 });
}


/** A failed accounting step must not stop Equipment from retiring a machine. */
export async function stageEquipmentBookRetirementInTx(
 tx:Tx,userId:string,applianceId:string,onDate:Date,intent:string="DECIDE_LATER"
):Promise<boolean>{
 await tx.$executeRaw`SAVEPOINT book_retire`;
 try{
  const existing=await tx.bookAsset.findUnique({where:{applianceId}});
  if(!existing){
   // Operational retirement must succeed; an equipment purchase already
   // recognized in the ledger must never disappear from the review queue.
   const appliance=await tx.appliance.findUnique({where:{id:applianceId},
    select:{acquisitionCostCents:true}});
   if(appliance?.acquisitionCostCents&&appliance.acquisitionCostCents>0)
    throw new BookAssetInputError("Recorded-cost appliance was retired before book enrollment; reconcile acquisition and disposal.");
  }
  if(existing&&!existing.retiredOn){
   const needed=[asMonth(onDate),lastCompletedMonth()].sort()[0]!;
   await postBookDepreciationInTx(tx,{kind:"equipment",userId},applianceId,needed,{maxMonths:360});
   const current=await tx.bookAsset.findUniqueOrThrow({where:{applianceId}});
   await retireBookAssetInTx(tx,{kind:"equipment",userId},applianceId,current.version,intent,businessDateKey(onDate));
  }
  await tx.booksProblem.updateMany({where:{kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",
   subjectType:"APPLIANCE",subjectId:applianceId,resolvedAt:null},data:{resolvedAt:onDate}});
  await tx.$executeRaw`RELEASE SAVEPOINT book_retire`;
  return true;
 }catch{
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT book_retire`;
  await tx.$executeRaw`RELEASE SAVEPOINT book_retire`;
  await tx.booksProblem.upsert({where:{kind_subjectType_subjectId:{
   kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",subjectType:"APPLIANCE",subjectId:applianceId,
  }},create:{kind:"APPLIANCE_RETIREMENT_NOT_RECORDED",subjectType:"APPLIANCE",subjectId:applianceId,
   message:"The appliance is retired, but its book value needs review."},
   update:{message:"The appliance is retired, but its book value needs review.",lastSeenAt:onDate,resolvedAt:null}});
  return false;
 }
}

/** Non-sale disposal removes value with one balanced, uniquely keyed journal. */
export async function writeOffRetiredBookAssetInTx(
 tx:Tx,writer:BooksWriter,applianceId:string,onDate:Date,reason:string
):Promise<void>{
 await assertBooksWriter(tx,writer,["OWNER","ADMIN"]);
 const existing=await tx.bookAsset.findUnique({where:{applianceId}});
 if(!existing){
  const appliance=await tx.appliance.findUnique({where:{id:applianceId},
   select:{acquisitionCostCents:true}});
  if(appliance?.acquisitionCostCents&&appliance.acquisitionCostCents>0)
   throw new BookAssetInputError("Retired appliance has a recorded acquisition cost but no book asset; review before disposal.");
  return;
 }
 const locked=await lockAsset(tx,applianceId);
 if(!locked.retiredOn)throw new BookAssetInputError("Book retirement must be staged before final disposal.");
 if(locked.disposedOn)return;
 if(onDate<locked.retiredOn)
  throw new BookAssetInputError("Disposal date cannot be before the recorded retirement date.");
 const carried=locked.retiredValueCents??0,cycle=locked.disposalCycle+1;
 if(!Number.isSafeInteger(carried)||carried<0)throw new BookAssetInputError("Book carrying value requires review.");
 if(carried>0){
  const plan=balancedPlan(onDate,`Retired appliance ${reason}: book value removed`,[
   {role:"DISPOSAL_LOSS",debitCents:carried,creditCents:0},
   {role:"RETIRED_PENDING_DISPOSITION",debitCents:0,creditCents:carried},
  ]);
  if(!plan||!await writeJournal(tx,"APPLIANCE",applianceId,"DISPOSED:"+cycle,plan,{applianceId}))
   throw new BookAssetInputError("Appliance disposal journal already recorded; review before retry.");
 }
 await tx.bookAsset.update({where:{applianceId},data:{disposedOn:onDate,disposalCycle:cycle,version:{increment:1}}});
 const audit=booksAuditActor(writer);
 await tx.auditLog.create({data:{userId:audit.userId,action:"books.asset.dispose",entityType:"BookAsset",
  entityId:applianceId,newValue:{cycle,reason,carriedCents:carried,by:audit.by}}});
}

/** Reopening is a new entry, never an edit or deletion of the original journal. */
export async function reverseBookAssetNonSaleDisposalInTx(
 tx:Tx,writer:BooksWriter,applianceId:string,onDate:Date
):Promise<void>{
 await assertBooksWriter(tx,writer,["OWNER","ADMIN"]);
 const existing=await tx.bookAsset.findUnique({where:{applianceId}});
 if(!existing?.disposedOn)return;
 const locked=await lockAsset(tx,applianceId);
 if(locked.disposalCycle<1)throw new BookAssetInputError("This disposal requires review.");
 const carried=locked.retiredValueCents??0;
 if(carried>0){
  const plan=balancedPlan(onDate,"Retired appliance plan reopened: book value restored",[
   {role:"RETIRED_PENDING_DISPOSITION",debitCents:carried,creditCents:0},
   {role:"DISPOSAL_LOSS",debitCents:0,creditCents:carried},
  ]);
  if(!plan||!await writeJournal(tx,"APPLIANCE",applianceId,"DISPOSAL_REVERSED:"+locked.disposalCycle,plan,{applianceId}))
   throw new BookAssetInputError("Disposal reversal already recorded; review before retry.");
 }
 await tx.bookAsset.update({where:{applianceId},data:{disposedOn:null,version:{increment:1}}});
 const audit=booksAuditActor(writer);
 await tx.auditLog.create({data:{userId:audit.userId,action:"books.asset.disposal.reversed",entityType:"BookAsset",
  entityId:applianceId,newValue:{cycle:locked.disposalCycle,by:audit.by}}});
}

/**
 * M-2C. A retired appliance is sold: its remaining book value leaves the books in ONE balanced entry (book value of
 * appliances sold, debited; the pending-disposition asset, credited). The sale price is income on the sale invoice
 * (Sales of retired appliances), so profit or loss on the sale is the two figures side by side, never counted twice
 * and the original cost is never expensed again. Runs inside the sale's own transaction. An appliance with no book
 * asset (nothing was ever capitalised) needs no entry.
 */
export async function disposeRetiredBookAssetInTx(tx:Tx,applianceId:string,soldOn:Date,invoiceId:string,actorUserId?:string):Promise<{carriedCents:number}>{
 await tx.$queryRaw`SELECT "applianceId" FROM "BookAsset" WHERE "applianceId" = ${applianceId} FOR UPDATE`;
 let asset=await tx.bookAsset.findUnique({where:{applianceId}});
 if(!asset){
  // No book asset is only "nothing capitalised" when there is also no acquisition cost or posted capitalised expense.
  const app=await tx.appliance.findUnique({where:{id:applianceId},select:{acquisitionCostCents:true}});
  const capitalised=await tx.expense.count({where:{applianceId,capitalizeToAppliance:true,status:"POSTED"}});
  if((app?.acquisitionCostCents??0)>0||capitalised>0)
   throw new BookAssetInputError("This appliance has a recorded cost that is not on the book assets list yet. Add it under Books, then Assets, and stage its retirement; then ring up the sale so its book value can be removed.");
  return {carriedCents:0};
 }
 if(!asset.retiredOn){
  if(!actorUserId)throw new BookAssetInputError("Book retirement needs an authorized employee.");
  const staged=await stageEquipmentBookRetirementInTx(tx,actorUserId,applianceId,soldOn,"SELL");
  if(!staged)throw new BookAssetInputError("This equipment's books need review before selling it.");
  asset=await tx.bookAsset.findUniqueOrThrow({where:{applianceId}});
 }
 if(!asset.retiredOn)throw new BookAssetInputError("Book retirement is still missing; correct the source evidence before sale.");
 if(asset.disposedOn)throw new BookAssetInputError("This appliance's book value was already removed by an earlier sale.");
 if(soldOn<asset.retiredOn)throw new BookAssetInputError("The sale cannot be dated before the appliance was retired.");
 const carried=asset.retiredValueCents??0;
 if(!Number.isSafeInteger(carried)||carried<0)throw new BookAssetInputError("Book carrying value is invalid; reconcile first.");
 if(carried>0){
  const plan=balancedPlan(soldOn,"Retired appliance sold: book value removed",[
   {role:"BOOK_VALUE_OF_APPLIANCES_SOLD",debitCents:carried,creditCents:0},
   {role:"RETIRED_PENDING_DISPOSITION",debitCents:0,creditCents:carried},
  ]);
  if(!plan||!await writeJournal(tx,"APPLIANCE",applianceId,"SOLD:"+invoiceId,plan,{applianceId}))
   throw new BookAssetInputError("This sale's book entry already exists; investigate.");
 }
 await tx.bookAsset.update({where:{applianceId},data:{disposedOn:soldOn,version:{increment:1}}});
 return {carriedCents:carried};
}

/** M-2C. The sale was cancelled: put the book value back with one reversing entry. */
export async function reverseBookAssetDisposalInTx(tx:Tx,applianceId:string,invoiceId:string,voidedAt:Date):Promise<void>{
 await tx.$queryRaw`SELECT "applianceId" FROM "BookAsset" WHERE "applianceId" = ${applianceId} FOR UPDATE`;
 const asset=await tx.bookAsset.findUnique({where:{applianceId}});
 if(!asset?.disposedOn)return;
 const carried=asset.retiredValueCents??0;
 if(carried>0){
  const plan=balancedPlan(voidedAt,"Retired appliance sale cancelled: book value restored",[
   {role:"RETIRED_PENDING_DISPOSITION",debitCents:carried,creditCents:0},
   {role:"BOOK_VALUE_OF_APPLIANCES_SOLD",debitCents:0,creditCents:carried},
  ]);
  if(!plan||!await writeJournal(tx,"APPLIANCE",applianceId,"SOLD_VOIDED:"+invoiceId,plan,{applianceId}))
   throw new BookAssetInputError("This sale's reversal already exists; investigate.");
 }
 await tx.bookAsset.update({where:{applianceId},data:{disposedOn:null,version:{increment:1}}});
}

/**
 * M-2C. How much retained book value had LEFT the books through a sale before a given instant, per appliance, read
 * from the dated "sold" and "sale cancelled" entries (so a sale that was later cancelled still counts for the dates in
 * between). Reports subtract this from the retired value.
 */
export async function disposedValueBefore(tx:Tx,before:Date):Promise<Map<string,number>>{
 const entries=await tx.journalEntry.findMany({where:{sourceType:"APPLIANCE",entryDate:{lt:before},
  OR:[{eventKind:{startsWith:"SOLD:"}},{eventKind:{startsWith:"SOLD_VOIDED:"}},
    {eventKind:{startsWith:"DISPOSED:"}},{eventKind:{startsWith:"DISPOSAL_REVERSED:"}}]},
  select:{sourceId:true,lines:{select:{debitCents:true,creditCents:true,ledgerAccount:{select:{systemRole:true}}}}},take:5001});
 if(entries.length>5000)throw new BookAssetInputError("Too many appliance sale entries to total safely; narrow the dates.");
 const out=new Map<string,number>();
 for(const e of entries)for(const l of e.lines)if(["BOOK_VALUE_OF_APPLIANCES_SOLD","DISPOSAL_LOSS"].includes(l.ledgerAccount.systemRole??""))
  out.set(e.sourceId,(out.get(e.sourceId)??0)+l.debitCents-l.creditCents);
 return out;
}
