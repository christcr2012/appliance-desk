import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey,businessDateKey,addBusinessDays } from "@/lib/business-date";
import { budgetSnapshotInTx } from "@/domains/budget/protected";
import { toCsv } from "@/lib/csv";
import {
 BudgetReportError,rangeOfMonth,monthKey,coloradoDay,nextDay,monthlyKeys,
 journalProfit,bankMovement,variancePercent,priorWindow,reportingRange,
 safeAdd,sha256,type SignedJournal,
} from "./report-math";

type Tx=Prisma.TransactionClient;
const CAP=10000;
const day=(s:string)=>coloradoDay(s);
const warn=(label:string)=>"Too many "+label+" sources to verify. Narrow the report; totals must not be truncated.";
const plusDays=(key:string,n:number)=>{const d=new Date(key+"T12:00:00Z");
 d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export type PublishedRow={
 envelopeId:string;name:string;groupLabel:string;openingSavedCents:number;
 plannedSpendCents:number;plannedFundCents:number;amountQuality:"EXACT"|"ESTIMATE"|"OWNER_REVIEWED";
 sourceOccurrenceIds:string[];targetId:string|null;
};
export type PublishedPayload={schemaVersion:1;monthKey:string;rows:PublishedRow[];
 sourceWarnings:string[];sourceBudgetRevision:string;sourceBookRevision:string;
 capturedAt:string;requestHash?:string;};
export function checkedPublished(value:unknown):PublishedPayload{
 if(!value||typeof value!=="object"||Array.isArray(value))
  throw new BudgetReportError("Published plan evidence was unreadable.");
 const p=value as Partial<PublishedPayload>;
 if(p.schemaVersion!==1||typeof p.monthKey!=="string"||!Array.isArray(p.rows)||
  !Array.isArray(p.sourceWarnings)||typeof p.sourceBudgetRevision!=="string"||
  typeof p.sourceBookRevision!=="string"||typeof p.capturedAt!=="string"||
  p.rows.length>500)throw new BudgetReportError("Published plan schema requires review.");
 const ids=new Set<string>();
 for(const row of p.rows){
  if(!row||typeof row.envelopeId!=="string"||!row.envelopeId||
   ids.has(row.envelopeId)||typeof row.name!=="string"||typeof row.groupLabel!=="string"||
   !["EXACT","ESTIMATE","OWNER_REVIEWED"].includes(row.amountQuality)||
   !Array.isArray(row.sourceOccurrenceIds)||
   row.sourceOccurrenceIds.some(id=>typeof id!=="string")||
   !(row.targetId===null||typeof row.targetId==="string"))
   throw new BudgetReportError("Published plan envelope evidence is invalid.");
  ids.add(row.envelopeId);
  safeCents(row.openingSavedCents,"opening saved",true);
  safeCents(row.plannedSpendCents,"planned spend");
  safeCents(row.plannedFundCents,"planned funding");
 }
 monthKey(p.monthKey);
 return p as PublishedPayload;
}
function asOfMonth(month:string,today:string){
 const bound=rangeOfMonth(month);return {from:bound.from,to:bound.to<today?bound.to:today};
}
// Calls share caller's single repeatable-read or serializable transaction; no remote provider reads.
async function journalsInTx(tx:Tx,from:string,to:string){
 if(from>to)return [] as Array<{
  id:string;entryDate:Date;entryNumber:number;sourceType:string;sourceId:string;eventKind:string;
  lines:Array<{id:string;ledgerAccountId:string;debitCents:number;creditCents:number;
   ledgerAccount:{name:string;type:string;systemRole:string|null}}>;
 }>;
 const entries=await tx.journalEntry.findMany({where:{entryDate:{gte:day(from),lt:day(nextDay(to))}},
  orderBy:[{entryDate:"asc"},{entryNumber:"asc"},{id:"asc"}],take:CAP+1,
  include:{lines:{include:{ledgerAccount:{select:{name:true,type:true,systemRole:true}}}}}});
 if(entries.length>CAP)throw new BudgetReportError(warn("journal"));
 return entries;
}
async function signedRows(tx:Tx,from:string,to:string):Promise<SignedJournal[]>{
 const entries=await journalsInTx(tx,from,to);
 const ids=[...new Set(entries.filter(e=>e.sourceType==="EXPENSE").map(e=>e.sourceId))];
 const sources=await tx.expense.findMany({where:{id:{in:ids}},
  select:{id:true,vendorName:true,recurringExpenseId:true,status:true}});
 const vendor=new Map(sources.map(x=>[x.id,x]));
 return entries.flatMap(entry=>entry.lines.map(l=>({
  lineId:l.id,entryId:entry.id,entryDate:businessDateKey(entry.entryDate),
  sourceType:entry.sourceType,sourceId:entry.sourceId,eventKind:entry.eventKind,
  accountId:l.ledgerAccountId,accountName:l.ledgerAccount.name,
  accountType:l.ledgerAccount.type,systemRole:l.ledgerAccount.systemRole,
  debitCents:l.debitCents,creditCents:l.creditCents,
  vendorName:entry.sourceType==="EXPENSE"?vendor.get(entry.sourceId)?.vendorName??null:null,
  recurring:entry.sourceType==="EXPENSE"&&Boolean(vendor.get(entry.sourceId)?.recurringExpenseId)
 })));
}
async function bankLedgerInTx(tx:Tx){
 const banks=await tx.cashAccount.findMany({where:{active:true},
  orderBy:[{name:"asc"},{id:"asc"}],
  select:{id:true,name:true,ledgerAccountId:true},take:501});
 if(banks.length>500)throw new BudgetReportError("Too many active bank sources to report safely.");
 return banks;
}
async function cashOpeningsInTx(tx:Tx,banks:{id:string;name:string;ledgerAccountId:string}[],before:string){
 if(!banks.length)return null;
 const groups=await tx.journalLine.groupBy({by:["ledgerAccountId"],
  where:{ledgerAccountId:{in:banks.map(b=>b.ledgerAccountId)},entry:{entryDate:{lt:day(before)}}},
  _sum:{debitCents:true,creditCents:true}});
 const byId=new Map(groups.map(x=>[x.ledgerAccountId,
  safeAdd(x._sum.debitCents??0,-(x._sum.creditCents??0))]));
 return banks.map(b=>({id:b.id,ledgerAccountId:b.ledgerAccountId,name:b.name,
  openingCents:byId.get(b.ledgerAccountId)??0}));
}
function completeCashAccounts(banks:Awaited<ReturnType<typeof cashOpeningsInTx>>,net:{
 perAccount:{id:string;netCents:number}[]},eligible:boolean){
 if(!eligible||!banks)return null;
 const movement=new Map(net.perAccount.map(x=>[x.id,x.netCents]));
 return banks.map(b=>({...b,netCents:movement.get(b.ledgerAccountId)??0,
  closingCents:safeAdd(b.openingCents,movement.get(b.ledgerAccountId)??0)}));
}
type ReadOptions={month:string;planId?:string;page?:number;pageSize?:number};
function checkPage(page:number,size:number){
 if(!Number.isSafeInteger(page)||page<1||page>100000||
  ![10,25,50,100].includes(size))
  throw new BudgetReportError("Choose a supported source page and size.");
 return {page,size};
}
export async function reportMonthInTx(tx:Tx,options:ReadOptions,today=businessDateKey(new Date())){
 const month=monthKey(options.month),{page,size}=checkPage(options.page??1,options.pageSize??25);
 coloradoDay(today);
 const window=asOfMonth(month,today);
 const versions=await tx.budgetPlanVersion.findMany({where:{monthKey:month},
  orderBy:[{version:"desc"}],take:100});
 const selected=options.planId?
  versions.find(x=>x.id===options.planId):versions[0];
 if(options.planId&&!selected)throw new BudgetReportError("Published plan version not found for that month.");
 let published:PublishedPayload|null=null;
 if(selected){
  if(sha256(selected.payload)!==selected.sha256)throw new BudgetReportError("Published plan failed integrity check.");
  published=checkedPublished(selected.payload);
 }
 const [state,bookRev,settings,envelopes,bankAccounts,allMoves,occurrences,qboPending,
  statementProof]=await Promise.all([
  tx.budgetState.findUniqueOrThrow({where:{id:"singleton"}}),
  tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
  tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{booksStartDate:true,cashBudgetEnabled:true}}),
  tx.budgetEnvelope.findMany({orderBy:[{sortOrder:"asc"},{id:"asc"}],take:501}),
  bankLedgerInTx(tx),
  tx.budgetMove.findMany({where:{createdAt:{lt:day(nextDay(window.to<window.from?window.from:window.to))}},
   orderBy:[{createdAt:"asc"},{id:"asc"}],take:CAP+1}),
  tx.budgetCostOccurrence.findMany({where:{dueOn:{gte:day(window.from),lte:day(rangeOfMonth(month).to)},
    status:{not:"CANCELLED"}},include:{plan:true,settlements:true},take:CAP+1}),
  tx.accountingDelivery.count({where:{status:"PREPARED",batch:{target:"QBO_JOURNAL_CSV"}}}),
  tx.bankReconciliation.findMany({where:{isCurrent:true,status:"COMPLETED"},
    select:{cashAccountId:true,toOn:true,endingCents:true},take:501}),
 ]);
 if(envelopes.length>500||allMoves.length>CAP||occurrences.length>CAP)
  throw new BudgetReportError(warn("budget"));
 const journal=await signedRows(tx,window.from,window.to);
 const profit=journalProfit(journal);
 const cash=bankMovement(journal,bankAccounts.map(x=>x.ledgerAccountId));
 const cashAccountOpenings=await cashOpeningsInTx(tx,bankAccounts,window.from);
 const cashOpening=cashAccountOpenings?.reduce((s,x)=>safeAdd(s,x.openingCents),0)??null;
 const moveSourceIds=[...new Set(allMoves.filter(m=>m.sourceType==="JOURNAL_LINE")
   .map(m=>m.sourceId).filter((x):x is string=>!!x))];
 const realSource=await tx.journalLine.findMany({where:{id:{in:moveSourceIds}},
  select:{id:true,entry:{select:{entryDate:true}}},take:CAP+1});
 if(realSource.length>CAP)throw new BudgetReportError(warn("budget source"));
 const sourceDate=new Map(realSource.map(x=>[x.id,businessDateKey(x.entry.entryDate)]));
 const spend=new Map<string,number>(),fund=new Map<string,number>(),opening=new Map<string,number>();
 for(const move of allMoves){
  const isJournal=move.sourceType==="JOURNAL_LINE";
  const effective=isJournal?sourceDate.get(move.sourceId??""):businessDateKey(move.createdAt);
  if(!effective)throw new BudgetReportError("A classified budget source disappeared; review its history.");
  if(effective<window.from){
   opening.set(move.envelopeId,safeAdd(opening.get(move.envelopeId)??0,move.signedCents));
   continue;
  }
  if(effective>window.to)continue;
  const value=move.signedCents;
  if(isJournal&&["SPEND","REFUND","REVERSAL"].includes(move.kind)){
   spend.set(move.envelopeId,safeAdd(spend.get(move.envelopeId)??0,-value));
  }else if(!isJournal){
   fund.set(move.envelopeId,safeAdd(fund.get(move.envelopeId)??0,value));
  }
 }
 // All unclassified real bank outflows stay visible; never conceal them
 // because no one has selected an envelope.
 const bankOutflows=await tx.journalLine.findMany({where:{
  ledgerAccountId:{in:bankAccounts.map(x=>x.ledgerAccountId)},creditCents:{gt:0},
  entry:{entryDate:{gte:day(window.from),lt:day(nextDay(window.to<window.from?window.from:window.to))}}},
  include:{budgetSpendSplits:{where:{active:true}},entry:{include:{
   lines:{include:{ledgerAccount:{select:{type:true,systemRole:true}}}}}}},
  take:CAP+1});
 if(bankOutflows.length>CAP)throw new BudgetReportError(warn("unclassified bank outflow"));
 let unclassifiedCount=0,unclassifiedCents=0;
 for(const line of bankOutflows){
  const others=line.entry.lines.filter(x=>x.id!==line.id&&x.debitCents>0);
  if(!others.some(x=>x.ledgerAccount.type==="EXPENSE"||
   x.ledgerAccount.systemRole==="OWNER_DRAWS"))continue;
  const assigned=line.budgetSpendSplits.reduce((sum,x)=>safeAdd(sum,x.amountCents),0);
  if(assigned<line.creditCents){
   unclassifiedCount++;
   unclassifiedCents=safeAdd(unclassifiedCents,line.creditCents-assigned);
  }
 }
 const publishedById=new Map((published?.rows??[]).map(row=>[row.envelopeId,row]));
 const costs=new Map<string,{dueCents:number;paidCents:number;unpaidCents:number}>();
 const sourceIds=[...new Set(occurrences.flatMap(o=>o.settlements
  .filter(s=>!s.reversalOfId&&s.sourceType==="EXPENSE").map(s=>s.sourceId)))];
 const expenseSources=await tx.expense.findMany({where:{id:{in:sourceIds}},select:{id:true,status:true}});
 const status=new Map(expenseSources.map(x=>[x.id,x.status]));
 for(const occ of occurrences){
  const undone=new Set(occ.settlements.flatMap(s=>s.reversalOfId?[s.reversalOfId]:[]));
  const paid=occ.settlements.filter(s=>s.reversalOfId===null&&!undone.has(s.id)&&
   s.sourceType==="EXPENSE"&&status.get(s.sourceId)==="POSTED").reduce(
    (sum,s)=>safeAdd(sum,s.amountCents),0);
  const existing=costs.get(occ.plan.envelopeId)??{dueCents:0,paidCents:0,unpaidCents:0};
  existing.dueCents=safeAdd(existing.dueCents,occ.amountCents);
  existing.paidCents=safeAdd(existing.paidCents,paid);
  existing.unpaidCents=safeAdd(existing.unpaidCents,Math.max(0,occ.amountCents-paid));
  costs.set(occ.plan.envelopeId,existing);
 }
 const monthRows=envelopes.map(envelope=>{
  const base=publishedById.get(envelope.id)??null;
  const spent=spend.get(envelope.id)??0,allocated=fund.get(envelope.id)??0;
  const comparison=variancePercent(base?.plannedSpendCents??null,spent);
  const funds=variancePercent(base?.plannedFundCents??null,allocated);
  const c=costs.get(envelope.id)??{dueCents:0,paidCents:0,unpaidCents:0};
  return {id:envelope.id,name:base?.name??envelope.name,
   groupLabel:base?.groupLabel??envelope.groupLabel,
   published:base!==null,plannedSpendCents:base?.plannedSpendCents??null,
   plannedFundCents:base?.plannedFundCents??null,
   openingSavedCents:base?.openingSavedCents??opening.get(envelope.id)??0,
   actualSpendCents:spent,actualFundingCents:allocated,
   actualClosingCents:safeAdd(opening.get(envelope.id)??0,allocated-spent),
   dueCents:c.dueCents,paidCents:c.paidCents,unpaidCents:c.unpaidCents,
   spendVariance:comparison,fundVariance:funds};
 });
 // Published envelope can have since been deactivated/archived/deleted:
 // never erase original plan from its stored month.
 for(const old of published?.rows??[]){
  if(monthRows.some(x=>x.id===old.envelopeId))continue;
  monthRows.push({id:old.envelopeId,name:old.name,groupLabel:old.groupLabel,
    published:true,plannedSpendCents:old.plannedSpendCents,
    plannedFundCents:old.plannedFundCents,openingSavedCents:old.openingSavedCents,
    actualSpendCents:spend.get(old.envelopeId)??0,actualFundingCents:fund.get(old.envelopeId)??0,
    actualClosingCents:old.openingSavedCents+(fund.get(old.envelopeId)??0)-(spend.get(old.envelopeId)??0),
    dueCents:0,paidCents:0,unpaidCents:0,
    spendVariance:variancePercent(old.plannedSpendCents,spend.get(old.envelopeId)??0),
    fundVariance:variancePercent(old.plannedFundCents,fund.get(old.envelopeId)??0)});
 }
 monthRows.sort((a,b)=>a.groupLabel.localeCompare(b.groupLabel)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const categories=new Map<string,{accountId:string,name:string,cents:number,entries:number}>();
 const vendors=new Map<string,{name:string,cents:number}>();
 let recurringExpenseCents=0,oneOffCents=0,unknownVendorCents=0;
 for(const r of journal.filter(j=>j.accountType==="EXPENSE")){
  const value=r.debitCents-r.creditCents;
  const category=categories.get(r.accountId)??{accountId:r.accountId,name:r.accountName,cents:0,entries:0};
  category.cents=safeAdd(category.cents,value);category.entries++;
  categories.set(r.accountId,category);
  if(r.recurring)recurringExpenseCents=safeAdd(recurringExpenseCents,value);
  else oneOffCents=safeAdd(oneOffCents,value);
  if(r.vendorName){
   const vendor=vendors.get(r.vendorName)??{name:r.vendorName,cents:0};
   vendor.cents=safeAdd(vendor.cents,value);vendors.set(r.vendorName,vendor);
  }else unknownVendorCents=safeAdd(unknownVendorCents,value);
 }
 const completeBanks=new Set(statementProof.filter(x=>businessDateKey(x.toOn)>=window.to)
  .map(x=>x.cashAccountId));
 const allStatements=bankAccounts.length>0&&bankAccounts.every(x=>completeBanks.has(x.id));
 const bankReady=bankAccounts.length>0&&allStatements&&cash.status==="KNOWN";
 const qboLegacy=await tx.exportBatch.count({where:{
  target:"QBO_JOURNAL_CSV",accountingDelivery:{is:null}}});
 const sourcesReady=settings.booksStartDate!==null&&settings.booksStartDate<=day(window.from)&&month<=today.slice(0,7);
 const checks=[
  {key:"plan",label:"Published monthly plan",ok:Boolean(selected),reason:selected?null:"No published version"},
  {key:"books",label:"Books posting and opening",ok:sourcesReady,reason:sourcesReady?null:"Books opening missing or too recent"},
  {key:"bank",label:"Verified bank statements for period",ok:bankReady,reason:bankReady?null:"One or more active bank statements are missing/incomplete"},
  {key:"spending",label:"Classified business-bank spending",ok:unclassifiedCents===0,reason:unclassifiedCents?unclassifiedCount+" unmatched outflow sources":null},
  {key:"qbo",label:"QBO delivery outcomes reviewed",ok:qboPending===0&&qboLegacy===0,reason:qboPending+qboLegacy? "Unconfirmed or legacy QBO archives":null},
 ];
 let backing:null|Awaited<ReturnType<typeof budgetSnapshotInTx>>=null;
 if(window.to>=window.from)backing=await budgetSnapshotInTx(tx,window.to);
 const ready=backing!==null&&backing.status==="READY"&&backing.unknownLiabilities.length===0;
 checks.push({key:"reserve",label:"Protected tax, customer and card backing",ok:ready,reason:ready?null:"Bank, tax, deposit or card source incomplete; do not allocate"});
 const upcomingRows=await tx.budgetCostOccurrence.findMany({where:{
  dueOn:{gte:day(today),lte:day(plusDays(today,90))},
  status:{not:"CANCELLED"},plan:{active:true}},
  include:{settlements:true},orderBy:[{dueOn:"asc"},{id:"asc"}],take:CAP+1});
 if(upcomingRows.length>CAP)throw new BudgetReportError(warn("upcoming cost"));
 const upcomingIds=[...new Set(upcomingRows.flatMap(x=>x.settlements.filter(s=>
  s.sourceType==="EXPENSE"&&s.reversalOfId===null).map(s=>s.sourceId)))];
 const verification=await tx.expense.findMany({where:{id:{in:upcomingIds}},
  select:{id:true,status:true}});
 const posted=new Set(verification.filter(x=>x.status==="POSTED").map(x=>x.id));
 const upcomingTotals=(until:string)=>{
  let dueCents=0,paidCents=0,unpaidCents=0,incompleteEvidence=0;
  for(const x of upcomingRows){
   if(businessDateKey(x.dueOn)>until)continue;
   const inverse=new Set(x.settlements.flatMap(s=>s.reversalOfId?[s.reversalOfId]:[]));
   const originals=x.settlements.filter(s=>s.reversalOfId===null&&!inverse.has(s.id));
   const paid=originals.filter(s=>s.sourceType==="EXPENSE"&&posted.has(s.sourceId))
    .reduce((sum,s)=>safeAdd(sum,s.amountCents),0);
   if(originals.some(s=>s.sourceType!=="EXPENSE"||!posted.has(s.sourceId)))
    incompleteEvidence++;
   dueCents=safeAdd(dueCents,x.amountCents);
   paidCents=safeAdd(paidCents,paid);
   unpaidCents=safeAdd(unpaidCents,Math.max(0,x.amountCents-paid));
  }
  return {dueCents,paidCents,unpaidCents,incompleteEvidence};
 };
 const upcoming={days30:upcomingTotals(plusDays(today,30)),days90:upcomingTotals(plusDays(today,90))};
 const sourcePages=journal.map(x=>({...x,kind:x.accountType==="EXPENSE"?"Expense":
  x.accountType==="INCOME"||x.accountType==="CONTRA_INCOME"?"Revenue":
  bankAccounts.some(b=>b.ledgerAccountId===x.accountId)?"Bank":"Other"}))
   .sort((a,b)=>a.entryDate.localeCompare(b.entryDate)||a.entryId.localeCompare(b.entryId)||a.accountId.localeCompare(b.accountId)||(a.lineId??"").localeCompare(b.lineId??""));
 const totalRows=sourcePages.length;
 const rows=sourcePages.slice((page-1)*size,page*size);
 const planStale=Boolean(selected&&(selected.budgetRevision!==state.revision||
  selected.sourceRevision!==bookRev.revision));
 return {month,through:window.to,today,sourceStatus:sourcesReady?"AVAILABLE":"UNKNOWN",
  sourceRevision:bookRev.revision.toString(),budgetRevision:state.revision.toString(),
  published:selected?{id:selected.id,version:selected.version,sha256:selected.sha256,
    publishedAt:selected.publishedAt.toISOString(),note:selected.note,
    sourceRevision:selected.sourceRevision.toString(),budgetRevision:selected.budgetRevision.toString(),
    stale:planStale}:null,
  versions:versions.map(v=>({id:v.id,version:v.version,date:v.publishedAt.toISOString(),
   sha256:v.sha256,stale:v.budgetRevision!==state.revision||v.sourceRevision!==bookRev.revision})),
  amountBasis:"POSTED_JOURNAL_ACCRUAL" as const,
  profit,cash:{...cash,accounts:completeCashAccounts(cashAccountOpenings,cash,sourcesReady),
   status:(sourcesReady?cash.status:"UNKNOWN") as "KNOWN"|"UNKNOWN",
   inflowCents:sourcesReady?cash.inflowCents:null,outflowCents:sourcesReady?cash.outflowCents:null,
   netCents:sourcesReady?cash.netCents:null,
   openingCents:sourcesReady?cashOpening:null,
   closingCents:!sourcesReady||cashOpening===null||cash.netCents===null?null:safeAdd(cashOpening,cash.netCents)},
  envelopes:monthRows,
  categories:[...categories.values()].map(x=>({...x,
   sharePercent:profit.costCents>0?Math.round(x.cents*10000/profit.costCents)/100:null}))
   .sort((a,b)=>b.cents-a.cents||a.name.localeCompare(b.name)),
  vendors:[...vendors.values()].map(x=>({...x,
   sharePercent:profit.costCents>0?Math.round(x.cents*10000/profit.costCents)/100:null}))
   .sort((a,b)=>b.cents-a.cents||a.name.localeCompare(b.name)),
  costSplit:{recurringCents:recurringExpenseCents,oneOffCents,unknownVendorCents},
  unclassifiedCents,unclassifiedCount,upcoming,
  sourceCount:totalRows,sourcePage:{page,pageSize:size,totalRows,rows},
  checklist:checks,allMonthEndReady:checks.every(x=>x.ok),
  protectedCents:backing?.protectedTotalCents??null,
  readyToAssignCents:ready?backing?.readyCents??null:null,
  sourceReasons:backing?.reasons??["Bank source not initialized."],
  overdueWarning:published?.sourceWarnings??[],
  costOccurrences:occurrences.length,
 };
}
export async function getBudgetMonthReport(userId:string,options:ReadOptions){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  return reportMonthInTx(tx,options);
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export async function getFinanceTrends(userId:string,options:{
 asOf?:string;months?:number;period?:string;from?:string;to?:string;
 compare?:"PREVIOUS_PERIOD"|"SAME_PERIOD_LAST_YEAR"|null;
 page?:number;pageSize?:number;
}={}){
 const today=businessDateKey(new Date()),asOf=options.asOf??today;
 coloradoDay(asOf);
 if(asOf>today)throw new BudgetReportError("Cannot report future journal activity as actual cash.");
 const months=monthlyKeys(asOf.slice(0,7),options.months??12);
 const current=reportingRange(options.period??"ROLLING_12",asOf,options.from,options.to);
 const previous=options.compare?priorWindow(current.from,current.to,options.compare):null;
 const {page,size}=checkPage(options.page??1,options.pageSize??25);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const [settings,booksRevision]=await Promise.all([
   tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{booksStartDate:true}}),
   tx.booksPostingRevision.findUniqueOrThrow({where:{id:"singleton"}}),
  ]);
  const banks=await bankLedgerInTx(tx);
  const ledgerIds=banks.map(x=>x.ledgerAccountId);
  const rangeFrom=months[0]+"-01";
  const first=[rangeFrom,current.from,previous?.from??rangeFrom].sort()[0]!;
  const last=[asOf,current.to,previous?.to??asOf].sort().at(-1)!;
  if(last>today)throw new BudgetReportError("Historical comparison cannot request future source entries.");
  const all=await signedRows(tx,first,last);
  const subset=(from:string,to:string)=>all.filter(x=>x.entryDate>=from&&x.entryDate<=to);
  const periodRows=subset(current.from,current.to),compareRows=previous?subset(previous.from,previous.to):[];
  const timeline=months.map(month=>{
   const window=rangeOfMonth(month),rows=subset(window.from,window.to<asOf?window.to:asOf);
   return {month,profit:journalProfit(rows),bank:bankMovement(rows,ledgerIds)};
  });
  const entries=periodRows.sort((a,b)=>a.entryDate.localeCompare(b.entryDate)||
   a.entryId.localeCompare(b.entryId)||a.accountId.localeCompare(b.accountId)||(a.lineId??"").localeCompare(b.lineId??""));
  const actual=journalProfit(entries),cash=bankMovement(entries,ledgerIds);
  const compareProfit=previous?journalProfit(compareRows):null;
  const percent=compareProfit?
   variancePercent(Math.max(0,compareProfit.revenueCents),actual.revenueCents):
   {differenceCents:null,percent:null,label:"No comparison selected"};
  const cashAccountOpenings=await cashOpeningsInTx(tx,banks,current.from);
 const opening=cashAccountOpenings?.reduce((s,x)=>safeAdd(s,x.openingCents),0)??null;
  const sourceOk=Boolean(settings.booksStartDate&&settings.booksStartDate<=day(first));
  return {asOf,range:current,compareRange:previous,period:options.period??"ROLLING_12",
   sourceRevision:booksRevision.revision.toString(),
   sourceStatus:sourceOk?"AVAILABLE" as const:"UNKNOWN" as const,
   basis:"POSTED_JOURNAL_ACCRUAL" as const,profit:actual,cash:{...cash,
    accounts:completeCashAccounts(cashAccountOpenings,cash,sourceOk),
    status:(sourceOk?cash.status:"UNKNOWN") as "KNOWN"|"UNKNOWN",
    inflowCents:sourceOk?cash.inflowCents:null,outflowCents:sourceOk?cash.outflowCents:null,
    netCents:sourceOk?cash.netCents:null,
    openingCents:sourceOk?opening:null,closingCents:!sourceOk||opening===null||cash.netCents===null?null:opening+cash.netCents},
   compareProfit,compareRevenue:percent,timeline,months:months.length,
   sourcePage:{page,pageSize:size,totalRows:entries.length,rows:entries.slice((page-1)*size,page*size)},
   allSourceRows:entries,reportWarnings:sourceOk?[]:["Books opening not initialized or precedes owner opening; figures do not certify prior history."],
  };
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
}
export async function financeReportCsv(userId:string,input:{
 asOf?:string;months?:number;period?:string;from?:string;to?:string;
 compare?:"PREVIOUS_PERIOD"|"SAME_PERIOD_LAST_YEAR"|null;
}={}){
 const report=await getFinanceTrends(userId,{...input,page:1,pageSize:25});
 const rows=report.allSourceRows.map(x=>({
  scope:"Book report (not QuickBooks import)",basis:report.basis,
  from:report.range.from,to:report.range.to,asOf:report.asOf,
  sourceRevision:report.sourceRevision,
  entryId:x.entryId,sourceType:x.sourceType,sourceId:x.sourceId,
  entryDate:x.entryDate,accountName:x.accountName,accountType:x.accountType,
  debitCents:x.debitCents,creditCents:x.creditCents,
  amountCents:x.accountType==="EXPENSE"?x.debitCents-x.creditCents:
   ["INCOME","CONTRA_INCOME"].includes(x.accountType)?x.creditCents-x.debitCents:0,
  vendor:x.vendorName??"Unknown source",
 }));
 const columns=Object.keys(rows[0]??{
  scope:"",basis:"",from:"",to:"",asOf:"",sourceRevision:"",entryId:"",sourceType:"",sourceId:"",
  entryDate:"",accountName:"",accountType:"",debitCents:0,creditCents:0,amountCents:0,vendor:"",
 }).map(key=>({key:key as keyof typeof rows[number],header:key}));
 return {fileName:"books-report-"+report.range.from+"_"+report.range.to+".csv",
  content:toCsv(columns,rows),sourceRows:rows.length,profit:report.profit};
}
