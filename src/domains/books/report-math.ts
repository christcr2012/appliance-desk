/** Batch K-7: deterministic whole-cent report math. No database and no provider operations. */
export type BookType="ASSET"|"CONTRA_ASSET"|"LIABILITY"|"EQUITY"|"INCOME"|"CONTRA_INCOME"|"EXPENSE";
export type BookReportLine={
 entryId:string;sourceType:string;sourceId:string;eventKind:string;
 accountId:string;accountName:string;accountType:BookType;
 systemRole:string|null;debitCents:number;creditCents:number;
};
export type ProfitRow={
 accountId:string;name:string;type:"INCOME"|"CONTRA_INCOME"|"EXPENSE";
 amountCents:number;entryIds:string[];
};
export class ReportIntegrityError extends Error{}
const integer=(n:number,label:string)=>{
 if(!Number.isSafeInteger(n))throw new ReportIntegrityError("Unsafe whole cents in "+label+".");
 return n;
};
const add=(a:number,b:number)=>integer(a+b,"report total");
export function summarizeAccrual(lines:BookReportLine[]){
 const values=new Map<string,ProfitRow>();
 for(const line of lines){
  const {accountType:type,accountId,entryId,accountName,debitCents,creditCents}=line;
  if(!["INCOME","CONTRA_INCOME","EXPENSE"].includes(type))continue;
  if(!Number.isSafeInteger(debitCents)||!Number.isSafeInteger(creditCents)||
    debitCents<0||creditCents<0||(debitCents>0&&creditCents>0))
   throw new ReportIntegrityError("Invalid journal cents; reconcile entry "+entryId+".");
  const amount=type==="INCOME"?creditCents-debitCents:debitCents-creditCents;
  const current=values.get(accountId)??{
   accountId,name:accountName,type:type as ProfitRow["type"],amountCents:0,entryIds:[],
  };
  if(current.type!==type)throw new ReportIntegrityError("Ledger account type changed while reporting.");
  current.amountCents=add(current.amountCents,amount);
  if(!current.entryIds.includes(entryId))current.entryIds.push(entryId);
  values.set(accountId,current);
 }
 const rows=[...values.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name)||a.accountId.localeCompare(b.accountId));
 const incomeCents=rows.filter(r=>r.type==="INCOME").reduce((n,r)=>add(n,r.amountCents),0);
 const reductionsCents=rows.filter(r=>r.type==="CONTRA_INCOME").reduce((n,r)=>add(n,r.amountCents),0);
 const expenseCents=rows.filter(r=>r.type==="EXPENSE").reduce((n,r)=>add(n,r.amountCents),0);
 return {rows,incomeCents,reductionsCents,expenseCents,
  netProfitCents:integer(incomeCents-reductionsCents-expenseCents,"net profit")};
}
export function summarizeBalance(lines:BookReportLine[]){
 type BalanceRow={accountId:string;name:string;type:BookType;systemRole:string|null;balanceCents:number;entryIds:string[]};
 const groups=new Map<string,BalanceRow>();
 let debits=0,credits=0;
 for(const line of lines){
  if(!Number.isSafeInteger(line.debitCents)||!Number.isSafeInteger(line.creditCents)||
   line.debitCents<0||line.creditCents<0||(line.debitCents>0&&line.creditCents>0))
   throw new ReportIntegrityError("Invalid journal cents; review "+line.entryId);
  debits=add(debits,line.debitCents);credits=add(credits,line.creditCents);
  const current=groups.get(line.accountId)??{
   accountId:line.accountId,name:line.accountName,type:line.accountType,
   systemRole:line.systemRole,balanceCents:0,entryIds:[],
  };
  const debitNormal=["ASSET","CONTRA_ASSET","CONTRA_INCOME","EXPENSE"].includes(line.accountType);
  current.balanceCents=add(current.balanceCents,debitNormal?
   line.debitCents-line.creditCents:line.creditCents-line.debitCents);
  if(!current.entryIds.includes(line.entryId))current.entryIds.push(line.entryId);
  groups.set(line.accountId,current);
 }
 if(debits!==credits)throw new ReportIntegrityError("Books are not balanced; no financial position can be certified.");
 const rows=[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
 const sum=(types:BookType[])=>rows.filter(r=>types.includes(r.type)).reduce((n,r)=>add(n,r.balanceCents),0);
 const assetsCents=sum(["ASSET","CONTRA_ASSET"]);
 const liabilitiesCents=sum(["LIABILITY"]),equityCents=sum(["EQUITY"]);
 const incomeCents=sum(["INCOME"])-sum(["CONTRA_INCOME"])-sum(["EXPENSE"]);
 const equationDifferenceCents=integer(assetsCents-liabilitiesCents-equityCents-incomeCents,"balance equation");
 if(equationDifferenceCents!==0)throw new ReportIntegrityError("Balance equation does not reconcile; review account types.");
 return {rows,assetsCents,liabilitiesCents,equityCents,
  retainedEarningsCents:incomeCents,equationDifferenceCents};
}
/** Split invoice cents among real distinct assigned asset IDs, never price lists.
 * Remainder is assigned in a stable ID order. Negative credits are symmetric. */
export function splitInvoiceCents(cents:number,applianceIds:string[]){
 integer(cents,"invoice amount");
 const ids=[...new Set(applianceIds)].sort();
 if(ids.length===0)return {shares:[] as {applianceId:string;amountCents:number}[],unallocatedCents:cents};
 const abs=Math.abs(cents);integer(abs,"invoice magnitude");
 const base=Math.floor(abs/ids.length),extra=abs%ids.length,sign=cents<0?-1:1;
 const shares=ids.map((applianceId,i)=>({applianceId,amountCents:sign*(base+(i<extra?1:0))}));
 return {shares,unallocatedCents:0};
}
export function paybackMath(input:{
 costCents:number|null;rentInvoicedCents:number;repairCostCents:number;
 lastSixMonthsRentCents:number;bookCarryingCents:number|null;
 rentLast12MonthsCents:number;repairLast12MonthsCents:number;lemonRepairPercent:number;
}){
 const cost=input.costCents===null?null:integer(input.costCents,"acquisition");
 const rent=integer(input.rentInvoicedCents,"rent");
 const repair=integer(input.repairCostCents,"repairs");
 const contribution=cost===null?null:integer(rent-repair-cost,"net contribution");
 const lastSix=integer(input.lastSixMonthsRentCents,"six month income");
 if(!Number.isSafeInteger(input.lemonRepairPercent)||input.lemonRepairPercent<0||input.lemonRepairPercent>100)
  throw new ReportIntegrityError("Invalid repair warning threshold.");
 const paybackMonths=cost===null||lastSix<=0?null:Math.ceil(Math.max(0,cost+repair-rent)/(lastSix/6));
 const lastYearRepair=integer(input.repairLast12MonthsCents,"trailing repair cost");
 const repairWarning=input.rentLast12MonthsCents>0&&lastYearRepair*100>input.rentLast12MonthsCents*input.lemonRepairPercent;
 return {netContributionCents:contribution,paybackMonths,
  paidForItself:cost===null?null:rent-repair>=cost,
  repairWarning,bookCarryingCents:input.bookCarryingCents};
}
