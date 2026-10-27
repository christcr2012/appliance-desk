import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey,addBusinessDays } from "@/lib/business-date";
import { computeTax } from "@/domains/tax/engine";
import { getAgreementTaxContext,loadRentalAcquisitionBasis,assertTaxReadyForAgreement } from "@/domains/tax/locations";
import { isSuccessfulPaymentStatus } from "@/domains/billing/payment-status";
import { profitAndLoss } from "./reports";
import { budgetSnapshotInTx } from "@/domains/budget/protected";
import { toCsv } from "@/lib/csv";
import { disposedValueBefore } from "./fixed-assets";
import { ruleAsOf } from "@/domains/rules/reads";
import {
 BooksClosingError,whole,add,calendarKey,futureBillingDates,recurringDates,
 refundAdjustedCollection,avgRentalMonths,cashTotals,type CashLine,
} from "./closing-math";

type Tx=Prisma.TransactionClient;
const CAP=5000;
const scoped=async(tx:Tx,userId:string)=>{
 await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
 return tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{
  booksStartDate:true,
 }});
};
const within=(rows:number,label:string)=>{if(rows>CAP)throw new BooksClosingError("Too many "+label+" sources; choose a smaller reporting period.");};
const date=(key:string)=>calendarKey(key);
const datePlus=(key:string,days:number)=>businessDateKey(addBusinessDays(date(key),days));
const jsonTotal=(value:unknown):number|null=>{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const totals=(value as Record<string,unknown>).totals;
 if(!totals||typeof totals!=="object"||Array.isArray(totals))return null;
 const n=(totals as Record<string,unknown>).remitCents;
 return typeof n==="number"&&Number.isSafeInteger(n)&&n>=0?n:null;
};
const num=(x:number)=>whole(x,"books closing");
const moneyCsv=(name:string,columns:{key:string;header:string}[],rows:Record<string,unknown>[])=>({
 filename:name,content:toCsv(columns,rows),
});
const col=(...pairs:[string,string][])=>pairs.map(([key,header])=>({key,header}));
export async function cashForecast(userId:string,days=90,now=new Date()){
 if(!Number.isSafeInteger(days)||days<1||days>180)throw new BooksClosingError("Choose 1–180 forecast days.");
 const today=businessDateKey(now),last=datePlus(today,days);
 return prisma.$transaction(async tx=>{
  const settings=await scoped(tx,userId);
  if(!settings.booksStartDate)throw new BooksClosingError("Owner must initialize Books before cash forecasting.");
  const [agreements,templates,taxPeriods,planned]=await Promise.all([
   tx.rentalAgreement.findMany({where:{status:"ACTIVE",stripeSubscriptionId:{not:null},
    billingStartedAt:{not:null},nextBillingDate:{not:null}},
    select:{id:true,nextBillingDate:true,endDate:true,
     lines:{select:{id:true,monthlyPriceCents:true}}},take:CAP+1}),
   tx.recurringExpense.findMany({where:{active:true},select:{
    id:true,name:true,amountCents:true,dayOfMonth:true,
   },take:CAP+1}),
   tx.taxFilingPeriod.findMany({where:{status:"OPEN",dueOn:{gte:date(today),lt:date(datePlus(last,1))}},
    include:{filingAccount:{select:{name:true}}},take:CAP+1}),
   tx.budgetCostOccurrence.findMany({where:{status:{in:["PLANNED","PART_PAID","PAID"]},
    dueOn:{gte:date(today),lt:date(datePlus(last,1))},plan:{active:true}},
    include:{plan:true,settlements:true},take:CAP+1}),
  ]);
  within(agreements.length,"billing");within(templates.length,"recurring expense");within(taxPeriods.length,"tax filing");within(planned.length,"planned budget cost");
  const rows:CashLine[]=[],needsReview:string[]=[];
  // Immutable budget claims are not payment proof after a Books expense is voided.
  // Recheck current authoritative source status before removing costs from forecast.
  const claimedExpenseIds=[...new Set(planned.flatMap(cost=>cost.settlements
   .filter(s=>s.reversalOfId===null&&s.sourceType==="EXPENSE").map(s=>s.sourceId)))];
  const paymentSources=claimedExpenseIds.length?await tx.expense.findMany({
   where:{id:{in:claimedExpenseIds}},select:{id:true,status:true},take:CAP+1}):[];
  within(paymentSources.length,"budget payment evidence");
  const postedExpenseIds=new Set(paymentSources.filter(e=>e.status==="POSTED").map(e=>e.id));
  const start=date(today),end=date(datePlus(last,1));
  for(const agreement of agreements){
   if(!agreement.nextBillingDate)continue;
   const prices=agreement.lines.map(l=>num(l.monthlyPriceCents));
   if(prices.some(n=>n<0)){needsReview.push("Agreement "+agreement.id+" has invalid price lines.");continue;}
   const base=prices.reduce(add,0);
   if(!base)continue;
   for(const instant of futureBillingDates(agreement.nextBillingDate,start,end)){
    if(agreement.endDate&&instant>agreement.endDate)continue;
    let billedCents=base;
    let confidence:"ESTIMATE"|"NEEDS_REVIEW"="ESTIMATE";
    let label="Future subscription invoice including current jurisdiction engine estimate, not collected";
    try {
     await assertTaxReadyForAgreement(tx,agreement.id,instant);
     const context=await getAgreementTaxContext(tx,agreement.id,instant);
     if(!context.jurisdictions.length)throw new BooksClosingError("Jurisdictions not yet verified");
     const lineInput=agreement.lines.map(line=>({key:line.id,kind:"RENTAL" as const,
      amountCents:line.monthlyPriceCents,rentalLineId:line.id}));
     const basis=await loadRentalAcquisitionBasis(tx,agreement.id,instant,lineInput);
     const evaluated=computeTax({...context,lines:lineInput.map(line=>({
      ...line,acquisitionBasis:basis.get(line.key),
     }))});
     if(!evaluated.ok)throw new BooksClosingError("Rental tax settings need accountant review");
     billedCents=add(base,evaluated.totalTaxCents);
    } catch {
     confidence="NEEDS_REVIEW";
     label="Future base invoice only — jurisdiction tax unavailable";
     needsReview.push("Agreement "+agreement.id+" billing "+businessDateKey(instant)+
      " has unverified future tax; shown base rent is not a complete invoice amount.");
    }
    rows.push({date:businessDateKey(instant),kind:"BILLING_ESTIMATE",
     amountCents:billedCents,sourceId:agreement.id,label,confidence});
   }
  }
  const coveredTemplateKeys=new Set<string>();
  for(const cost of planned){
   if(cost.plan.sourceType==="RECURRING_EXPENSE"&&cost.plan.sourceId)
    coveredTemplateKeys.add(cost.plan.sourceId+":"+businessDateKey(cost.dueOn));
   const canceled=new Set(cost.settlements.flatMap(s=>s.reversalOfId?[s.reversalOfId]:[]));
   const originals=cost.settlements.filter(s=>!s.reversalOfId&&!canceled.has(s.id));
   const valid=originals.filter(s=>s.sourceType==="EXPENSE"&&postedExpenseIds.has(s.sourceId));
   if(valid.length!==originals.length)
    needsReview.push("Budget bill "+cost.id+" contains voided or unavailable payment evidence; treat the unsupported portion as unpaid until corrected.");
   const paid=valid.reduce((sum,s)=>sum+s.amountCents,0);
   const unpaid=Math.max(0,cost.amountCents-paid);
   if(unpaid>0){
    if(cost.plan.sourceType==="TAX_FILING"&&cost.plan.sourceId){
     needsReview.push("Budget tax source "+cost.plan.sourceId+" is protected and cannot duplicate a filing estimate.");
     continue;
    }
    rows.push({date:businessDateKey(cost.dueOn),kind:"BUDGET_PLAN_ESTIMATE",
     amountCents:unpaid,sourceId:cost.id,label:cost.plan.name+" — unpaid "+cost.plan.amountQuality.toLowerCase()+" plan (not booked)",
     confidence:"ESTIMATE"});
   }
  }
  const expenseIds=templates.map(t=>t.id);
  const existing=expenseIds.length?await tx.expense.findMany({where:{
   recurringExpenseId:{in:expenseIds},spentOn:{gte:start,lt:end},status:{in:["DRAFT","SUBMITTED","POSTED"]}},
   select:{recurringExpenseId:true,spentOn:true},take:CAP+1}):[];
  within(existing.length,"repeating expense");
  const already=new Set(existing.map(e=>e.recurringExpenseId+":"+businessDateKey(e.spentOn)));
  for(const template of templates){
   for(const due of recurringDates(template.dayOfMonth,today,last)){
    if(already.has(template.id+":"+due)||coveredTemplateKeys.has(template.id+":"+due))continue;
    rows.push({date:due,kind:"RECURRING_EXPENSE_ESTIMATE",amountCents:num(template.amountCents),
     label:template.name,sourceId:template.id,confidence:"ESTIMATE"});
   }
  }
  for(const period of taxPeriods){
   const estimated=jsonTotal(period.worksheet);
   if(estimated===null){
    needsReview.push("Open "+period.filingAccount.name+" tax period "+businessDateKey(period.periodStart)+" needs a saved, verified worksheet.");
    continue;
   }
   rows.push({date:businessDateKey(period.dueOn),kind:"TAX_WORKSHEET_ESTIMATE",
    amountCents:estimated,sourceId:period.id,
    label:period.filingAccount.name+" — open worksheet, not filed or paid",
    confidence:"ESTIMATE"});
  }

  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind)||a.sourceId.localeCompare(b.sourceId));
  // One existing K-8 source contract. Cash from unresolved bank evidence stays unknown;
  // scheduled invoices are a separate estimate, NEVER ready-to-assign money.
  let verifiedCashCents:number|null=null;
  try{
   const budget=await budgetSnapshotInTx(tx,today);
   if(budget.bankEvidence.length&&budget.bankEvidence.every(b=>b.statementTo===today&&
    b.bookDifferenceCents===0&&b.status!=="UNKNOWN"))verifiedCashCents=budget.eligibleBankCents;
   if(verifiedCashCents===null)needsReview.push("Confirmed bank cash unavailable or not reconciled through today; both projected cash tracks are incomplete.");
  }catch{
   needsReview.push("Confirmed bank evidence is unavailable for this projection.");
  }
  const plannedOutflows=rows.filter(x=>x.kind!=="BILLING_ESTIMATE")
   .reduce((sum,x)=>add(sum,x.amountCents),0);
  const estimatedInvoicing=rows.filter(x=>x.kind==="BILLING_ESTIMATE")
   .reduce((sum,x)=>add(sum,x.amountCents),0);
  const firstShortfall=(includeInvoicing:boolean)=>{
   if(verifiedCashCents===null)return null;
   let balance=verifiedCashCents;
   for(const line of rows){
    if(line.kind==="BILLING_ESTIMATE"&&!includeInvoicing)continue;
    balance=add(balance,line.kind==="BILLING_ESTIMATE"?line.amountCents:-line.amountCents);
    if(balance<0)return {date:line.date,shortfallCents:-balance};
   }
   return null;
  };
  return {from:today,through:last,days,kind:"ESTIMATE" as const,rows,
   needsReview,totals:cashTotals(rows),
   tracks:{
    noNewCollections:{openingConfirmedCashCents:verifiedCashCents,
     projectedCents:verifiedCashCents===null?null:add(verifiedCashCents,-plannedOutflows),
     firstShortfall:firstShortfall(false),kind:"CONFIRMED_CASH_MINUS_ESTIMATED_COSTS" as const},
    expectedCollections:{openingConfirmedCashCents:verifiedCashCents,
     projectedCents:verifiedCashCents===null?null:add(verifiedCashCents,add(estimatedInvoicing,-plannedOutflows)),
     firstShortfall:firstShortfall(true),kind:"ESTIMATED_BILLING_NOT_COLLECTED" as const}
   },
   disclaimer:"No-new-collections uses reconciled current bank evidence minus planned unpaid costs. Expected collections are future invoicing estimates, not receipts. Neither raises Ready or authorizes payment. Unknown source facts stay incomplete."};
  
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export async function customerHealth(userId:string,asOf=new Date()){
 const key=businessDateKey(asOf);
 if(asOf>new Date())throw new BooksClosingError("Customer health cannot be evaluated in the future.");
 return prisma.$transaction(async tx=>{
  const settings=await scoped(tx,userId);
  if(!settings.booksStartDate)throw new BooksClosingError("Initialize Books before evaluating customer health.");
  const [agreements,leads,payments,refunds]=await Promise.all([
   tx.rentalAgreement.findMany({select:{id:true,customerId:true,status:true,startDate:true,
    endDate:true,closedAt:true,billingStartedAt:true},take:CAP+1}),
   tx.lead.findMany({where:{convertedCustomerId:{not:null}},select:{
    convertedCustomerId:true,howHeard:true,createdAt:true},orderBy:{createdAt:"asc"},take:CAP+1}),
   tx.payment.findMany({where:{receiptId:{not:null},createdAt:{lte:asOf}},
    select:{invoice:{select:{customerId:true}},amountCents:true,status:true},take:CAP+1}),
   tx.refund.findMany({where:{createdAt:{lte:asOf}},
    select:{invoice:{select:{customerId:true}},amountCents:true},take:CAP+1}),
  ]);
  within(agreements.length,"agreements");within(leads.length,"leads");
  within(payments.length,"payments");within(refunds.length,"refunds");
  const source=new Map<string,string>();
  for(const lead of leads)if(lead.convertedCustomerId&&!source.has(lead.convertedCustomerId))
   source.set(lead.convertedCustomerId,lead.howHeard?.trim()||"Unknown");
  const paid=new Map<string,number>(),returned=new Map<string,number>();
  for(const p of payments)if(isSuccessfulPaymentStatus(p.status))
   paid.set(p.invoice.customerId,add(paid.get(p.invoice.customerId)??0,num(p.amountCents)));
  for(const f of refunds)returned.set(f.invoice.customerId,
   add(returned.get(f.invoice.customerId)??0,num(f.amountCents)));
  const customers=new Set([...agreements.map(a=>a.customerId),...paid.keys(),...returned.keys()]);
  const bySource=new Map<string,{customers:number;netCollectedCents:number}>();
  let activeRentals=0,endingNext90Days=0,endedRentals=0;
  const next90=datePlus(key,90),completed:{start:string;end:string}[]=[];
  for(const a of agreements){
   const started=a.status==="ACTIVE"&&!!a.billingStartedAt&&a.billingStartedAt<=asOf;
   if(started)activeRentals++;
   if(started&&a.endDate&&businessDateKey(a.endDate)>=key&&businessDateKey(a.endDate)<=next90)endingNext90Days++;
   if(a.status==="ENDED"){endedRentals++;const first=a.billingStartedAt??a.startDate,finish=a.closedAt??a.endDate;
    if(first&&finish&&finish>=first)completed.push({start:businessDateKey(first),end:businessDateKey(finish)});
   }
  }
  let collectedNetCents=0;
  for(const customerId of customers){
   const net=refundAdjustedCollection(paid.get(customerId)??0,returned.get(customerId)??0);
   collectedNetCents=add(collectedNetCents,net);
   const key=source.get(customerId)??"Unknown";
   const current=bySource.get(key)??{customers:0,netCollectedCents:0};
   current.customers++;current.netCollectedCents=add(current.netCollectedCents,net);
   bySource.set(key,current);
  }
  return {asOf:key,activeRentals,endingNext90Days,endedRentals,
   averageCompletedRentalMonths:avgRentalMonths(completed),measuredCompleted:completed.length,
   knownCustomers:customers.size,netCollectedCents:collectedNetCents,
   sourceGroups:[...bySource].map(([leadSource,data])=>({leadSource,...data}))
    .sort((a,b)=>a.leadSource.localeCompare(b.leadSource)),
   caveat:"Collections count successful invoice-applied receipt money less refunds, not refundable deposits, unapplied funds or account credit transfers. Unknown lead sources remain unattributed."};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
type YearFile="monthly-profit"|"assets"|"tax-filed"|"expenses"|"suppliers";
export const YEAR_FILES:YearFile[]=["monthly-profit","assets","tax-filed","expenses","suppliers"];
export async function yearEndPackage(userId:string,year:number,requestedFile:YearFile){
 if(!Number.isSafeInteger(year)||year<2020||year>Number(businessDateKey(new Date()).slice(0,4))||
   !YEAR_FILES.includes(requestedFile))throw new BooksClosingError("Unsupported accounting year or package file.");
 const today=businessDateKey(new Date()),start=year+"-01-01",yearEnd=year+"-12-31";
 const until=yearEnd<today?yearEnd:today;
 const startDate=date(start),endDate=date(datePlus(until,1));
 const settings=await prisma.$transaction(tx=>scoped(tx,userId));
 if(!settings.booksStartDate||settings.booksStartDate>endDate)
  throw new BooksClosingError("Year predates owner-attested Books opening.");
 if(requestedFile==="monthly-profit"){
  const rows:Record<string,unknown>[]=[];
  for(let m=1;m<=12;m++){
   const month=year+"-"+String(m).padStart(2,"0");
   let first=month+"-01";
   if(first>today)break;
   const endOfMonth=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
   const last=endOfMonth<=today?endOfMonth:today;
   if(date(first)<settings.booksStartDate)first=businessDateKey(settings.booksStartDate);
   if(first>last)continue;
   const accrued=await profitAndLoss(userId,{from:first,to:last,basis:"ACCRUAL"});
   const cash=await profitAndLoss(userId,{from:first,to:last,basis:"CASH"});
   rows.push({month,from:first,through:last,accrualIncomeCents:accrued.summary.incomeCents,
    accrualReductionsCents:accrued.summary.reductionsCents,
    accrualExpenseCents:accrued.summary.expenseCents,
    accrualNetCents:accrued.summary.netProfitCents,cashNetCents:cash.summary.netProfitCents,
    cashAllocationsNeedingReview:cash.needsReview.length});
  }
  return moneyCsv("books-"+year+"-monthly-profit.csv",col(
   ["month","Month"],["from","From"],["through","Through"],
   ["accrualIncomeCents","Accrual income cents"],["accrualReductionsCents","Contra-income cents"],
   ["accrualExpenseCents","Accrual expenses cents"],["accrualNetCents","Accrual profit cents"],
   ["cashNetCents","Cash-basis profit cents"],["cashAllocationsNeedingReview","Cash items requiring review"]),rows);
 }
 return prisma.$transaction(async tx=>{
  await scoped(tx,userId);
  if(requestedFile==="assets"){
   const assets=await tx.bookAsset.findMany({where:{placedInServiceOn:{lt:endDate}},include:{
    appliance:{select:{assetNumber:true}},
    taxEvidence:{where:{createdAt:{lt:endDate}},orderBy:{createdAt:"desc"},take:1,
     select:{classification:true,confidence:true}},
   },orderBy:{applianceId:"asc"},take:CAP+1});
   within(assets.length,"assets");
   const depreciation=await tx.journalEntry.findMany({where:{sourceType:"APPLIANCE",
    eventKind:{startsWith:"DEPRECIATION:"},entryDate:{lt:endDate}},
    select:{sourceId:true,lines:{select:{debitCents:true,ledgerAccount:{select:{systemRole:true}}}}},take:CAP+1});
   within(depreciation.length,"depreciation journals");
   const disposed=await disposedValueBefore(tx,endDate);
   const used=new Map<string,number>();
   for(const j of depreciation)for(const line of j.lines)if(line.ledgerAccount.systemRole==="DEPRECIATION")
    used.set(j.sourceId,add(used.get(j.sourceId)??0,line.debitCents));
   return moneyCsv("books-"+year+"-assets.csv",col(
    ["asset","Asset"],["inService","In service"],["originalCostCents","Book cost cents"],
    ["postedDepreciationCents","Cumulative book depreciation cents"],["carryingCents","Book carrying cents"],
    ["retiredIntent","Retirement intent"],["basisClassification","Income-tax classification"],
    ["taxBasisConfidence","CPA confidence"]),assets.map(a=>({
     asset:a.appliance.assetNumber,inService:businessDateKey(a.placedInServiceOn),
     originalCostCents:a.costCents,postedDepreciationCents:used.get(a.applianceId)??0,
     carryingCents:a.retiredOn&&a.retiredOn<endDate?(a.retiredValueCents===null?null:a.retiredValueCents-(disposed.get(a.applianceId)??0)):a.costCents-(used.get(a.applianceId)??0),
     retiredIntent:a.retiredOn&&a.retiredOn<endDate?a.retirementIntent??"": "",
     basisClassification:a.taxEvidence[0]?.classification??"UNKNOWN",
     taxBasisConfidence:a.taxEvidence[0]?.confidence??"UNKNOWN",
    })));
  }
  if(requestedFile==="tax-filed"){
   const periods=await tx.taxFilingPeriod.findMany({where:{status:"FILED",
    periodEnd:{gte:startDate,lt:endDate}},include:{filingAccount:{select:{name:true,kind:true}}},
    orderBy:[{periodEnd:"asc"},{id:"asc"}],take:CAP+1});
   within(periods.length,"filed tax records");
   return moneyCsv("books-"+year+"-filed-tax.csv",col(
    ["account","Filing account"],["kind","Return type"],["periodEnd","Period ended"],
    ["filedOn","Filed date"],["worksheetRemitCents","Worksheet remit cents"],
    ["amountPaidCents","Confirmed payment cents"],["confirmation","Confirmation"]),periods.map(p=>({
      account:p.filingAccount.name,kind:p.filingAccount.kind,periodEnd:businessDateKey(p.periodEnd),
      filedOn:p.filedOn?businessDateKey(p.filedOn):"UNKNOWN",
      worksheetRemitCents:jsonTotal(p.worksheet)??"UNKNOWN",
      amountPaidCents:p.amountPaidCents??"NOT CONFIRMED",
      confirmation:p.confirmationNumber??"NOT RECORDED",
    })));
  }
  const source=await tx.journalEntry.findMany({where:{sourceType:"EXPENSE",entryDate:{gte:startDate,lt:endDate},
    eventKind:{in:["EXPENSE_POSTED","EXPENSE_VOIDED"]}},include:{
    lines:{include:{ledgerAccount:{select:{type:true,systemRole:true}}}},
   },orderBy:[{entryDate:"asc"},{entryNumber:"asc"}],take:CAP+1});
  within(source.length,"expense journals");
  const expenses=await tx.expense.findMany({where:{id:{in:[...new Set(source.map(x=>x.sourceId))]}},
   select:{id:true,category:{select:{name:true}},supplierId:true,vendorName:true,
    paidFromAccountId:true,amountCents:true}});
  const byId=new Map(expenses.map(e=>[e.id,e]));
  if(requestedFile==="expenses"){
   const grouped=new Map<string,number>();
   for(const journal of source){
    const expense=byId.get(journal.sourceId);
    if(!expense)continue;
    let value=0;
    for(const line of journal.lines)if(line.ledgerAccount.type==="EXPENSE")
     value=add(value,line.debitCents-line.creditCents);
    grouped.set(expense.category.name,add(grouped.get(expense.category.name)??0,value));
   }
   return moneyCsv("books-"+year+"-expenses.csv",col(
    ["category","Expense category"],["actualPostedCents","Source journal expense cents"]),[...grouped].sort((a,b)=>a[0].localeCompare(b[0])).map(([category,actualPostedCents])=>({category,actualPostedCents})));
  }
  const supplierIds=[...new Set(expenses.flatMap(e=>e.supplierId?[e.supplierId]:[]))];
  const suppliers=await tx.supplier.findMany({where:{id:{in:supplierIds},is1099Vendor:true},
   select:{id:true,name:true,taxIdOnFile:true}});
  const marked=new Map(suppliers.map(s=>[s.id,s]));
  const accounts=await tx.ledgerAccount.findMany({where:{id:{in:expenses.map(e=>e.paidFromAccountId)}},
   select:{id:true,isPaymentSource:true}});
  const paymentSource=new Set(accounts.filter(a=>a.isPaymentSource).map(a=>a.id));
  const totals=new Map<string,number>();
  const unsupported=new Set<string>();
  for(const journal of source){
   const e=byId.get(journal.sourceId);
   if(!e?.supplierId||!marked.has(e.supplierId))continue;
   if(!paymentSource.has(e.paidFromAccountId)){unsupported.add(e.supplierId);continue;}
   // Only immutable cash-source journal credits are vendor payments.
   // A later EXPENSE_VOIDED reversing debit offsets the candidate amount.
   const paid=journal.lines.filter(l=>l.ledgerAccountId===e.paidFromAccountId)
    .reduce((n,l)=>add(n,l.creditCents-l.debitCents),0);
   if(!paid){unsupported.add(e.supplierId);continue;}
   totals.set(e.supplierId,add(totals.get(e.supplierId)??0,paid));
  }
  // TFA-1: the 1099 limit is a dated rule; the payment year's January 1 value applies.
  const threshold=(await ruleAsOf<number>("us.1099.threshold",date(year+"-01-01"),tx)).value;
  return moneyCsv("books-"+year+"-1099-review.csv",col(
   ["supplier","1099-marked supplier"],["postedPaidCents","Source-confirmed paid cents"],
   ["thresholdCents","Rule review threshold cents"],["reviewStatus","Review status"],
   ["taxIdOnFile","Tax ID recorded"]),suppliers.map(s=>{
    const value=totals.get(s.id)??0;
    return {supplier:s.name,postedPaidCents:value,thresholdCents:threshold,
     reviewStatus:unsupported.has(s.id)?"INCOMPLETE SOURCE — CPA REVIEW":
      value>=threshold?"CANDIDATE — CPA REVIEW":"BELOW THRESHOLD — CPA REVIEW",
     taxIdOnFile:s.taxIdOnFile?"YES":"NO"};
   }));
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
