import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey,businessDateKey } from "@/lib/business-date";
import { jobPartsCosts } from "@/domains/purchasing/ledger";
import {
 type BookReportLine,type BookType,ReportIntegrityError,
 summarizeAccrual,summarizeBalance,splitInvoiceCents,paybackMath,
} from "./report-math";

type Tx=Prisma.TransactionClient;
export type ProfitBasis="ACCRUAL"|"CASH";
export type ProfitCompare="PREVIOUS_PERIOD"|"SAME_PERIOD_LAST_YEAR"|null;
const CAP=10_000;
const date=(key:string)=>{
 const parsed=businessDateFromKey(key);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!parsed||businessDateKey(parsed)!==key)
  throw new ReportIntegrityError("Choose a real Colorado calendar day.");
 return parsed;
};
const shifted=(s:string,days:number)=>{
 const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
};
const exclusive=(end:string)=>date(shifted(end,1));
function bounds(from:string,to:string){
 const start=date(from),end=date(to);
 if(start>end||end>new Date()||Math.round((Date.parse(to)-Date.parse(from))/86400000)>366)
  throw new ReportIntegrityError("Choose at most 366 past Colorado calendar days in chronological order.");
 return {start,end:exclusive(to)};
}
async function authorized(tx:Tx,userId:string){
 await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
 const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true,lemonRepairPercent:true}});
 if(!settings?.booksStartDate)throw new ReportIntegrityError("Owner must initialize Books before reading financial reports.");
 return settings;
}
const mapEntry=(entry:{
 id:string;sourceType:string;sourceId:string;eventKind:string;
 lines:{ledgerAccountId:string;debitCents:number;creditCents:number;
 ledgerAccount:{name:string;systemRole:string|null;type:BookType}}[];
}):BookReportLine[]=>
 entry.lines.map(line=>({
  entryId:entry.id,sourceType:entry.sourceType,sourceId:entry.sourceId,eventKind:entry.eventKind,
  accountId:line.ledgerAccountId,accountName:line.ledgerAccount.name,
  accountType:line.ledgerAccount.type,systemRole:line.ledgerAccount.systemRole,
  debitCents:line.debitCents,creditCents:line.creditCents,
 }));
async function journals(tx:Tx,range:{start?:Date;end:Date}){
 const entries=await tx.journalEntry.findMany({where:{entryDate:{gte:range.start,lt:range.end}},
  include:{lines:{include:{ledgerAccount:{select:{
   name:true,systemRole:true,type:true,
  }}}}},orderBy:[{entryDate:"asc"},{entryNumber:"asc"}],take:CAP+1});
 if(entries.length>CAP)throw new ReportIntegrityError("Too many posted journals; narrow the report dates before trusting totals.");
 return entries;
}
type JournalRows=Awaited<ReturnType<typeof journals>>;
function flatten(rows:JournalRows):BookReportLine[]{
 return rows.flatMap(entry=>mapEntry(entry));
}
function compareDates(from:string,to:string,compare:ProfitCompare){
 if(!compare)return null;
 if(compare==="PREVIOUS_PERIOD"){
  const n=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  return {from:shifted(from,-n),to:shifted(to,-n)};
 }
 if(compare==="SAME_PERIOD_LAST_YEAR"){
  const prior=(s:string)=>{const d=s.slice(0,4);const yyyy=String(Number(d)-1);
   const value=yyyy+s.slice(4);return businessDateFromKey(value)?value:yyyy+"-02-28";};
  return {from:prior(from),to:prior(to)};
 }
 throw new ReportIntegrityError("Unknown comparison.");
}
async function cashJournalLines(tx:Tx,rows:JournalRows):Promise<{
 lines:BookReportLine[];needsReview:string[];
}> {
 const result:BookReportLine[]=[];
 const needsReview:string[]=[];
 for(const entry of rows){
  // Posted real business expenses and actual outgoing refunds/fees are cash expenses.
  if(entry.sourceType==="EXPENSE"&&["EXPENSE_POSTED","EXPENSE_VOIDED"].includes(entry.eventKind)||
     entry.sourceType==="STRIPE_BALANCE_TXN"||
     entry.sourceType==="REFUND"&&entry.eventKind==="REFUND_ISSUED"){
   result.push(...mapEntry(entry).filter(x=>["EXPENSE","CONTRA_INCOME"].includes(x.accountType)));
   continue;
  }
  if(entry.sourceType!=="PAYMENT"||entry.eventKind!=="PAYMENT_APPLIED")continue;
  const payment=await tx.payment.findUnique({where:{id:entry.sourceId},include:{receipt:true,invoice:true}});
  if(!payment?.receipt||payment.invoice.status==="DRAFT"||payment.invoice.status==="VOID"||
    !Number.isSafeInteger(payment.amountCents)||payment.amountCents<=0){
   needsReview.push("Payment "+entry.sourceId+" lacks a compatible source receipt or finalized invoice.");
   continue;
  }
  const original=await tx.journalEntry.findUnique({
   where:{sourceType_sourceId_eventKind:{sourceType:"INVOICE",sourceId:payment.invoiceId,eventKind:"INVOICE_RECOGNIZED"}},
   include:{lines:{include:{ledgerAccount:{select:{name:true,systemRole:true,type:true}}}}},
  });
  if(!original||payment.invoice.amountDueCents<=0||payment.amountCents>payment.invoice.amountDueCents){
   needsReview.push("Invoice "+payment.invoiceId+" lacks a complete, safe journal allocation.");
   continue;
  }
  const all=mapEntry(original);
  const gross=all.filter(l=>l.accountType==="INCOME"||l.accountType==="CONTRA_INCOME");
  const signed=(l:BookReportLine)=>l.accountType==="INCOME"?l.creditCents-l.debitCents:-(l.debitCents-l.creditCents);
  const tax=all.filter(l=>l.systemRole?.startsWith("SALES_TAX:")||l.systemRole==="SALES_TAX_UNASSIGNED")
    .reduce((n,l)=>n+l.creditCents-l.debitCents,0);
  if(!gross.length||gross.reduce((n,l)=>n+signed(l),0)+tax!==payment.invoice.amountDueCents){
   needsReview.push("Invoice "+payment.invoiceId+" journal/tax basis needs accountant review.");
   continue;
  }
  // Fractional receipt allocated to gross income, credits and tax at identical
  // proportions; reconcile last-cent remainder to the first positive income row.
  const scale=(value:number)=>Math.trunc(value*payment.amountCents/payment.invoice.amountDueCents);
  const weights=gross.map(l=>scale(signed(l)));
  let appliedTax=scale(tax);
  let remainder=payment.amountCents-appliedTax-weights.reduce((n,x)=>n+x,0);
  const firstIncome=gross.findIndex(l=>l.accountType==="INCOME"&&signed(l)>0);
  if(firstIncome<0||!Number.isSafeInteger(remainder)){
   needsReview.push("Invoice "+payment.invoiceId+" requires manual cash categorization.");continue;
  }
  weights[firstIncome]+=remainder;
  if(weights[firstIncome]<0){needsReview.push("Invoice "+payment.invoiceId+" has invalid cash revenue allocation.");continue;}
  for(let i=0;i<gross.length;i++){
   const l=gross[i]!,amount=weights[i]!;
   const positive=l.accountType==="INCOME"?amount:-amount;
   if(!positive)continue;
   result.push({...l,entryId:entry.id,sourceType:"PAYMENT",sourceId:entry.sourceId,eventKind:"CASH_APPLIED",
    debitCents:positive<0?-positive:0,creditCents:positive>0?positive:0});
  }
 }
 return {lines:result,needsReview};
}
export async function profitAndLoss(userId:string,options:{
 from:string;to:string;basis:ProfitBasis;compare?:ProfitCompare;
}) {
 const b=bounds(options.from,options.to);
 if(!["ACCRUAL","CASH"].includes(options.basis))
  throw new ReportIntegrityError("Choose cash or accrual report basis.");
 const compare=compareDates(options.from,options.to,options.compare??null);
 return prisma.$transaction(async tx=>{
  const settings=await authorized(tx,userId);
  if(b.start<settings.booksStartDate!)throw new ReportIntegrityError("Report begins before the owner-attested Books opening date.");
  const load=async(from:string,to:string)=>{
   const v=bounds(from,to),items=await journals(tx,v);
   if(options.basis==="ACCRUAL")return {summary:summarizeAccrual(flatten(items)),needsReview:[] as string[]};
   const cash=await cashJournalLines(tx,items);
   return {summary:summarizeAccrual(cash.lines),needsReview:cash.needsReview};
  };
  const current=await load(options.from,options.to);
  const previous=compare&&date(compare.from)>=settings.booksStartDate!?await load(compare.from,compare.to):null;
  return {from:options.from,to:options.to,basis:options.basis,compare, ...current, previous};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export async function balanceSnapshot(userId:string,asOf:string){
 const limit=exclusive(asOf);
 if(date(asOf)>new Date())throw new ReportIntegrityError("Balance snapshot date is in the future.");
 return prisma.$transaction(async tx=>{
  await authorized(tx,userId);
  const data=flatten(await journals(tx,{end:limit}));
  return {asOf,...summarizeBalance(data)};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export async function appliancePayback(userId:string,asOf=new Date()){
 if(asOf>new Date())throw new ReportIntegrityError("Cannot forecast historical payback as actual.");
 return prisma.$transaction(async tx=>{
  const settings=await authorized(tx,userId);
  const end=exclusive(businessDateKey(asOf));
  const [assets,postedInvoices,assignments,jobs,expenses,sourceLines]=await Promise.all([
   tx.appliance.findMany({where:{archivedAt:null},select:{
    id:true,assetNumber:true,acquisitionCostCents:true,
    bookAsset:{select:{costCents:true,retiredOn:true,retiredValueCents:true}},
   },take:2000,orderBy:{assetNumber:"asc"}}),
   tx.journalEntry.findMany({where:{sourceType:"INVOICE",eventKind:"INVOICE_RECOGNIZED",entryDate:{lt:end}},
    select:{sourceId:true},take:CAP+1}),
   tx.applianceAssignment.findMany({select:{applianceId:true,rentalLineId:true,assignedAt:true,unassignedAt:true}}),
   tx.jobAppliance.findMany({where:{job:{type:"MAINTENANCE_VISIT",status:"COMPLETED",completedAt:{lt:end}}},
    select:{applianceId:true,job:{select:{id:true,partsCostCents:true,laborCostCents:true}}}}),
   tx.expense.findMany({where:{status:"POSTED",capitalizeToAppliance:false,applianceId:{not:null},spentOn:{lt:end}},
    select:{id:true,applianceId:true,jobId:true,amountCents:true}}),
   tx.invoiceLineItem.findMany({where:{kind:{in:["RENTAL","LATE_RETURN"]},
    invoice:{status:{notIn:["DRAFT","VOID"]}}},
    select:{invoiceId:true,kind:true,amountCents:true,rentalLineId:true,
     invoice:{select:{createdAt:true,billingPeriodStart:true}}},take:CAP+1}),
  ]);
  if(postedInvoices.length>CAP||sourceLines.length>CAP)
   throw new ReportIntegrityError("Too many rental sources; narrow records before trusting payback.");
  const sources=new Set(postedInvoices.map(x=>x.sourceId));
  const revenues=new Map<string,number>(),last6=new Map<string,number>(),last12=new Map<string,number>();
  let unallocatedInvoiceCents=0;
  const key=businessDateKey(asOf);
  const [y,m]=key.slice(0,7).split("-").map(Number);
  const cutoff6=new Date(Date.UTC(y,m-6,1)).toISOString().slice(0,7);
  const cutoff12=new Date(Date.UTC(y,m-12,1)).toISOString().slice(0,7);
  for(const line of sourceLines){
   if(!sources.has(line.invoiceId))continue;
   const at=line.invoice.billingPeriodStart??line.invoice.createdAt;
   if(at>end)continue;
   if(!line.rentalLineId){unallocatedInvoiceCents+=line.amountCents;continue;}
   const ids=assignments.filter(a=>a.rentalLineId===line.rentalLineId&&a.assignedAt<=at&&
    (!a.unassignedAt||a.unassignedAt>at)).map(a=>a.applianceId);
   const distribution=splitInvoiceCents(line.amountCents,ids);
   unallocatedInvoiceCents+=distribution.unallocatedCents;
   const month=businessDateKey(at).slice(0,7);
   for(const split of distribution.shares){
    revenues.set(split.applianceId,(revenues.get(split.applianceId)??0)+split.amountCents);
    if(month>=cutoff6)last6.set(split.applianceId,(last6.get(split.applianceId)??0)+split.amountCents);
    if(month>=cutoff12)last12.set(split.applianceId,(last12.get(split.applianceId)??0)+split.amountCents);
   }
  }
  const repairJobs=await jobPartsCosts(tx,[...new Set(jobs.map(j=>j.job.id))]);
  const knownJobIds=new Set(jobs.map(j=>j.job.id));
  const cost=new Map<string,number>(),unknownCost=new Set<string>();
  for(const item of jobs){
   const part=repairJobs.get(item.job.id);
   const partCents=part?.source==="ITEMIZED"?part.cents:item.job.partsCostCents;
   if(partCents===null||partCents===undefined||item.job.laborCostCents===null||part?.unknownCostLines)
    unknownCost.add(item.applianceId);
   cost.set(item.applianceId,(cost.get(item.applianceId)??0)+(partCents??0)+(item.job.laborCostCents??0));
  }
  for(const e of expenses){
   // A job-linked expense can be the same parts/labor bill already in Job; flag and
   // do not double count that expense as a second appliance repair cost.
   if(e.jobId&&knownJobIds.has(e.jobId)){unknownCost.add(e.applianceId!);continue;}
   cost.set(e.applianceId!,(cost.get(e.applianceId!)??0)+e.amountCents);
  }
  const bookTotals=await tx.journalEntry.findMany({where:{
    sourceType:"APPLIANCE",eventKind:{startsWith:"DEPRECIATION:"},entryDate:{lt:end}},
   select:{sourceId:true,lines:{select:{debitCents:true,ledgerAccount:{select:{systemRole:true}}}}}});
  const depreciation=new Map<string,number>();
  for(const e of bookTotals)for(const l of e.lines)if(l.ledgerAccount.systemRole==="DEPRECIATION")
   depreciation.set(e.sourceId,(depreciation.get(e.sourceId)??0)+l.debitCents);
  return {asOf:businessDateKey(asOf),unallocatedInvoiceCents,
   incompleteRentalSources:unallocatedInvoiceCents!==0,
   rows:assets.map(a=>{
    const rent=revenues.get(a.id)??0,repair=cost.get(a.id)??0,book=a.bookAsset;
    const base=book?.costCents??a.acquisitionCostCents;
    const carrying=book?.retiredOn?book.retiredValueCents??null:
      book?book.costCents-(depreciation.get(a.id)??0):null;
    return {applianceId:a.id,assetNumber:a.assetNumber,costKnown:base!==null,
     rentInvoicedCents:rent,repairCostCents:repair,repairCostComplete:!unknownCost.has(a.id),
     ...paybackMath({costCents:base,rentInvoicedCents:rent,repairCostCents:repair,
      lastSixMonthsRentCents:last6.get(a.id)??0,rentLast12MonthsCents:last12.get(a.id)??0,
      bookCarryingCents:carrying,lemonRepairPercent:settings.lemonRepairPercent}),
    };
   })};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
