import { createHash } from "node:crypto";
import { businessDateFromKey,businessDateKey } from "@/lib/business-date";

export class BudgetReportError extends Error{}
export type MonthKey=string;
export function monthKey(value:string) {
 if(!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)||Number(value.slice(0,4))<2020)
  throw new BudgetReportError("Choose a real reporting month.");
 return value;
}
export function coloradoDay(key:string){
 const date=businessDateFromKey(key);
 if(!date||businessDateKey(date)!==key)throw new BudgetReportError("Choose a real Colorado report date.");
 return date;
}
export function rangeOfMonth(month:string) {
 monthKey(month);
 const [year,number]=month.split("-").map(Number);
 const to=String(year)+"-"+month.slice(5)+"-"+String(new Date(Date.UTC(year,number,0)).getUTCDate()).padStart(2,"0");
 return {from:month+"-01",to};
}
export function nextDay(key:string) {
 coloradoDay(key);
 const d=new Date(key+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);
 return d.toISOString().slice(0,10);
}
export function addMonths(month:string,offset:number){
 monthKey(month);
 if(!Number.isInteger(offset)||Math.abs(offset)>120)throw new BudgetReportError("Too many report periods.");
 const n=Number(month.slice(0,4))*12+Number(month.slice(5))-1+offset;
 return String(Math.floor(n/12)).padStart(4,"0")+"-"+String(n%12+1).padStart(2,"0");
}
export function reportingRange(period:string,today:string,from?:string,to?:string){
 coloradoDay(today);
 if(period==="CUSTOM"){
  if(!from||!to)throw new BudgetReportError("Choose from and through dates.");
  coloradoDay(from);coloradoDay(to);
  const n=(Date.parse(to)-Date.parse(from))/86400000;
  if(n<0||n>365||to>today)throw new BudgetReportError("Custom report is at most 366 days and cannot end in the future.");
  return {from,to};
 }
 if(period==="MONTH"){
  const month=today.slice(0,7);return {from:month+"-01",to:today};
 }
 if(period==="QUARTER"){
  const m=Number(today.slice(5,7)),first=String(Math.floor((m-1)/3)*3+1).padStart(2,"0");
  return {from:today.slice(0,4)+"-"+first+"-01",to:today};
 }
 if(period==="YTD"||period==="YEAR")return {from:today.slice(0,4)+"-01-01",to:today};
 if(period==="ROLLING_12"){
  const start=addMonths(today.slice(0,7),-11);return {from:start+"-01",to:today};
 }
 throw new BudgetReportError("Choose month, quarter, year, rolling year or custom dates.");
}
export function priorWindow(from:string,to:string,kind:"PREVIOUS_PERIOD"|"SAME_PERIOD_LAST_YEAR"){
 coloradoDay(from);coloradoDay(to);
 if(from>to)throw new BudgetReportError("Invalid comparison dates.");
 const shift=(value:string,days:number)=>{const d=new Date(value+"T00:00:00Z");
  d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
 if(kind==="PREVIOUS_PERIOD"){
  const days=(Date.parse(to)-Date.parse(from))/86400000+1;
  return {from:shift(from,-days),to:shift(to,-days)};
 }
 const shiftYear=(value:string)=>{const prior=String(Number(value.slice(0,4))-1)+value.slice(4);
  return businessDateFromKey(prior)?prior:String(Number(value.slice(0,4))-1)+"-02-28";};
 return {from:shiftYear(from),to:shiftYear(to)};
}
export function safeAdd(a:number,b:number) {
 const n=a+b;if(!Number.isSafeInteger(n))throw new BudgetReportError("Financial total is outside safe whole cents.");
 return n;
}
export function safeCents(n:number,label:string,allowNegative=false) {
 if(!Number.isSafeInteger(n)||Math.abs(n)>2_000_000_000||!allowNegative&&n<0)
  throw new BudgetReportError("Invalid "+label+" whole-cent amount.");
 return n;
}
export function variancePercent(plan:number|null,actual:number) {
 if(plan===null)return {differenceCents:null,percent:null,label:"Unplanned — no published baseline"};
 safeCents(plan,"planned amount");safeCents(actual,"actual signed amount",true);
 const difference=safeAdd(actual,-plan);
 if(plan===0)return {differenceCents:difference,percent:null,label:"No percentage — planned amount is zero"};
 return {differenceCents:difference,percent:Math.round(difference*10000/plan)/100,
  label:difference>0?"Over plan":difference<0?"Under plan":"On plan"};
}
export function stable(value:unknown):string {
 if(value===undefined)return "null";
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
 return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
  .map(([key,v])=>JSON.stringify(key)+":"+stable(v)).join(",")+"}";
}
export const sha256=(value:unknown)=>createHash("sha256").update(stable(value)).digest("hex");
export type SignedJournal={
 lineId?:string;entryId:string;entryDate:string;sourceType:string;sourceId:string;eventKind:string;
 accountId:string;accountName:string;accountType:string;systemRole:string|null;
 debitCents:number;creditCents:number;vendorName?:string|null;recurring?:boolean;
};
export function signedAccountingRow(row:SignedJournal){
 safeCents(row.debitCents,"debit");safeCents(row.creditCents,"credit");
 if(row.debitCents&&row.creditCents)throw new BudgetReportError("One ledger side per journal line.");
 if(row.accountType==="INCOME")return {kind:"REVENUE" as const,amountCents:row.creditCents-row.debitCents};
 if(row.accountType==="CONTRA_INCOME")return {kind:"REVENUE" as const,amountCents:row.creditCents-row.debitCents};
 if(row.accountType==="EXPENSE")return {kind:"COST" as const,amountCents:row.debitCents-row.creditCents};
 return {kind:"EXCLUDED" as const,amountCents:0};
}
export function journalProfit(rows:SignedJournal[]){
 let revenueCents=0,costCents=0,depreciationCents=0;
 for(const r of rows){
  const p=signedAccountingRow(r);
  if(p.kind==="REVENUE")revenueCents=safeAdd(revenueCents,p.amountCents);
  if(p.kind==="COST"){
   costCents=safeAdd(costCents,p.amountCents);
   if(/DEPRECIATION/i.test(r.systemRole??""))
    depreciationCents=safeAdd(depreciationCents,p.amountCents);
  }
 }
 return {revenueCents,costCents,depreciationCents,operatingCostCents:costCents-depreciationCents,
  netProfitCents:safeAdd(revenueCents,-costCents)};
}
export function bankMovement(rows:SignedJournal[],bankLedgerIds:string[]){
 const ids=new Set(bankLedgerIds),known=ids.size>0;
 let inflowCents=0,outflowCents=0;
 const accounts=new Map<string,{id:string,name:string,netCents:number}>();
 for(const row of rows){
  if(!ids.has(row.accountId))continue;
  const signed=safeAdd(row.debitCents,-row.creditCents);
  const prev=accounts.get(row.accountId)??{id:row.accountId,name:row.accountName,netCents:0};
  prev.netCents=safeAdd(prev.netCents,signed);accounts.set(row.accountId,prev);
  if(signed>0)inflowCents=safeAdd(inflowCents,signed);
  else outflowCents=safeAdd(outflowCents,-signed);
 }
 return {status:known?"KNOWN" as const:"UNKNOWN" as const,
  inflowCents:known?inflowCents:null,outflowCents:known?outflowCents:null,
  netCents:known?inflowCents-outflowCents:null,
  perAccount:[...accounts.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))};
}
export function monthlyKeys(asOf:string,count:number){
 monthKey(asOf);if(!Number.isInteger(count)||count<1||count>60)
  throw new BudgetReportError("Select 1–60 monthly history columns.");
 return Array.from({length:count},(_,i)=>addMonths(asOf,i+1-count));
}

/**
 * Chris decided 2026-10-22: an owner may replace an estimate with their own estimate ("Owner reviewed"),
 * but a row stays an estimate until real bank data replaces it, so an unchanged estimate is never relabelled EXACT.
 */
export function assertPublishedQuality(
  sourceQuality:"EXACT"|"ESTIMATE"|"OWNER_REVIEWED",changed:boolean,requested:"EXACT"|"ESTIMATE"|"OWNER_REVIEWED"){
  if(changed&&requested!=="OWNER_REVIEWED")
    throw new BudgetReportError("Use Owner reviewed quality for manual cost/funding changes.");
  if(!changed&&sourceQuality!=="EXACT"&&requested==="EXACT")
    throw new BudgetReportError("An estimate stays an estimate until real bank data replaces it; it cannot be marked exact by hand.");
}
