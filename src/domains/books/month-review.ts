import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { lastBusinessDay, lastCompletedMonth, monthKey, nextMonth } from "./depreciation";
import { postPending } from "./post";
import { profitAndLoss } from "./reports";
import { checkStripeClearing } from "./stripe-balance";
import type { BooksActor } from "./management";

type ReviewCheck = { ok:boolean; label:string; detail:string; count:number };
type PaymentPart = { state:"MATCHED"|"NOT_SET_UP"|"NEEDS_REVIEW"; detail:string; unmatchedCents:number };
const safeCount=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw new Error("Books review count is invalid.");return n;};

export function assetDueForMonth(asset:{
 placedInServiceOn:Date;retiredOn:Date|null;fullyDepreciatedOn:Date|null;lifeMonths:number;
},key:string):boolean{
 monthKey(key);
 const first=nextMonth(businessDateKey(asset.placedInServiceOn).slice(0,7));
 if(key<first || asset.retiredOn && key>=businessDateKey(asset.retiredOn).slice(0,7) ||
  asset.fullyDepreciatedOn&&key>businessDateKey(asset.fullyDepreciatedOn).slice(0,7))return false;
 let due=first;
 for(let i=1;i<asset.lifeMonths;i++)due=nextMonth(due);
 return key<=due;
}

export async function monthReview(actor:BooksActor,key:string,now=new Date()){
 monthKey(key);
 if(key>lastCompletedMonth(now))throw new Error("Review a month that has ended.");
 await prisma.$transaction(tx=>assertActiveTeamActor(tx,actor.id,["OWNER","ADMIN"]));
 const first=businessDateFromKey(key+"-01")!,last=lastBusinessDay(key);
 const next=businessDateFromKey(nextMonth(key)+"-01")!;
 const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
  select:{booksStartDate:true,accountantEmail:true,booksReviewReminderDay:true}});
 if(!settings.booksStartDate)throw new Error("Start your books before reviewing a month.");
 if(key<businessDateKey(settings.booksStartDate).slice(0,7))
  throw new Error("This month is before your Books start.");
 const [status,expenses,assets,accounts,postedDepreciations]=await Promise.all([
  prisma.accountingPeriod.findUnique({where:{periodKey:key}}),
  prisma.expense.findMany({where:{spentOn:{gte:first,lt:next}},
   select:{id:true,status:true,receiptPhotoId:true,noReceiptReason:true,amountCents:true,
    category:{select:{name:true}}},take:10001}),
  prisma.bookAsset.findMany({where:{placedInServiceOn:{lt:next}},
   select:{applianceId:true,placedInServiceOn:true,retiredOn:true,fullyDepreciatedOn:true,lifeMonths:true},take:10001}),
  prisma.cashAccount.findMany({select:{id:true,name:true,
   imports:{select:{id:true},take:1},
   reconciliations:{where:{isCurrent:true,status:"COMPLETED",
    fromOn:{lte:first},toOn:{gte:last}},select:{id:true},take:1}},take:501}),
  prisma.journalEntry.findMany({where:{sourceType:"APPLIANCE",
   eventKind:"DEPRECIATION:"+key},select:{sourceId:true},take:10001}),
 ]);
 const limitsExceeded=expenses.length>10000||assets.length>10000||accounts.length>500||
  postedDepreciations.length>10000;
 const pending=await postPending({limit:500,inspectMonth:key});
 const sourceCount=pending.problems.length;
 const sources:ReviewCheck={label:"Everything was recorded",ok:!limitsExceeded&&!sourceCount,
  count:safeCount(sourceCount),detail:limitsExceeded?"The record count needs a smaller accountant review.":sourceCount
   ?sourceCount+" source entries still need to be recorded. Check your Books problems."
   :"All recognized source records for this month have a journal."};
 const incomplete=expenses.filter(e=>["DRAFT","SUBMITTED"].includes(e.status)||
  e.status==="POSTED"&&!e.receiptPhotoId&&!e.noReceiptReason?.trim());
 const costs:ReviewCheck={label:"Expenses are complete",ok:!limitsExceeded&&!incomplete.length,
  count:incomplete.length,detail:incomplete.length
   ?incomplete.length+" expenses need posting, a receipt or an explanation."
   :"Posted expenses have a receipt or a documented reason."};
 const bankStates:PaymentPart[]=[];
 for(const account of accounts){
  if(!account.imports.length){bankStates.push({state:"NOT_SET_UP",detail:account.name+": no bank statements connected",unmatchedCents:0});continue;}
  if(account.reconciliations.length){bankStates.push({state:"MATCHED",detail:account.name+": reconciled through month end",unmatchedCents:0});continue;}
  const unmatched=await prisma.bankObservation.aggregate({where:{
   cashAccountId:account.id,isActive:true,status:"UNMATCHED",
   postedOn:{gte:first,lt:next}},_sum:{signedCents:true},_count:{_all:true}});
  bankStates.push({state:"NEEDS_REVIEW",detail:account.name+": "+unmatched._count._all+" bank lines not matched yet",
   unmatchedCents:unmatched._sum.signedCents??0});
 }
 const stripeCheck=process.env.BOOKS_STRIPE_SYNC_ENABLED==="true"
  // Stripe compares through the day *before* this argument, so pass next-month start.
  ?await checkStripeClearing(next):null;
 const stripe:PaymentPart=!stripeCheck
  ?{state:"NOT_SET_UP",detail:"Stripe sync has not been switched on.",unmatchedCents:0}
  :stripeCheck.state==="MATCH"
   ?{state:"MATCHED",detail:"Stripe clearing matches the recorded balance.",unmatchedCents:0}
   :stripeCheck.state==="DIFFERENCE"
    ?{state:"NEEDS_REVIEW",detail:"Stripe is off by the recorded amount.",
      unmatchedCents:stripeCheck.differenceCents}
    :{state:"NEEDS_REVIEW",detail:"reason" in stripeCheck ? stripeCheck.reason : "Stripe needs review.",unmatchedCents:0};
 const paymentBlocked=bankStates.filter(x=>x.state==="NEEDS_REVIEW").length+
  (stripe.state==="NEEDS_REVIEW"?1:0);
 const payments:ReviewCheck={label:"Payments add up",ok:paymentBlocked===0&&accounts.length<=500,
  count:paymentBlocked,detail:paymentBlocked?paymentBlocked+" payment sources need reconciliation."
   :"Matched sources reconcile. Unconnected bank and Stripe sources can be set up later."};
 const booked=new Set(postedDepreciations.map(x=>x.sourceId));
 const missing=assets.filter(asset=>assetDueForMonth(asset,key)&&!booked.has(asset.applianceId));
 const equipment:ReviewCheck={label:"Equipment value recorded",ok:!limitsExceeded&&!missing.length,
  count:missing.length,detail:missing.length
   ?missing.length+" appliances are missing this month's depreciation entry."
   :"Every appliance due for depreciation has its journal."};
 const profitStart=key===businessDateKey(settings.booksStartDate).slice(0,7)
  ?businessDateKey(settings.booksStartDate):key+"-01";
 const profit=await profitAndLoss(actor.id,{from:profitStart,
  to:businessDateKey(last),basis:"ACCRUAL",
  compare:key>businessDateKey(settings.booksStartDate).slice(0,7)?"PREVIOUS_PERIOD":null});
 const categories=new Map<string,number>();
 for(const expense of expenses.filter(x=>x.status==="POSTED")){
  const name=expense.category.name;
  categories.set(name,(categories.get(name)??0)+expense.amountCents);
 }
 const topCategories=[...categories].sort((a,b)=>b[1]-a[1]).slice(0,3)
  .map(([name,amountCents])=>({name,amountCents}));
 const received=await prisma.receipt.aggregate({where:{receivedOn:{gte:first,lt:next}},
  _sum:{amountCents:true}});
 return {key,status:status?.status??"OPEN",lockedAt:status?.closedAt??null,
  accountantSentAt:status?.accountantSentAt??null,
  accountantEmail:settings.accountantEmail,
  reviewReminderDay:settings.booksReviewReminderDay,
  reviewNotes:status?.reviewNotes??null,
  checks:{sources,costs,payments,equipment},
  bankStates,stripe,profit:profit.summary,
  priorProfit:profit.previous?.summary??null,
  collectedCents:received._sum.amountCents??0,
  topCategories,missingDepreciationIds:missing.slice(0,20).map(x=>x.applianceId),
  pendingSourceCount:sourceCount};
}
