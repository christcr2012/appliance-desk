import { billingPeriodFor,businessDateFromKey,businessDateKey } from "@/lib/business-date";

export class BooksClosingError extends Error {}
export function whole(value:number,label:string){
 if(!Number.isSafeInteger(value)||Math.abs(value)>1_000_000_000_000)
  throw new BooksClosingError("Unsafe cents for "+label+".");
 return value;
}
export function add(a:number,b:number){return whole(a+b,"report total");}
export function calendarKey(date:string){
 const d=businessDateFromKey(date);
 if(!d||businessDateKey(d)!==date)throw new BooksClosingError("Choose a real Colorado date.");
 return d;
}
export function nextCalendarMonth(month:string){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new BooksClosingError("Invalid month.");
 const [year,m]=month.split("-").map(Number);
 return new Date(Date.UTC(year,m,1)).toISOString().slice(0,7);
}
export function monthDay(month:string,day:number){
 if(!Number.isSafeInteger(day)||day<1||day>28)throw new BooksClosingError("Recurring day must be 1–28.");
 return month+"-"+String(day).padStart(2,"0");
}
/** Reuse billingPeriodFor's original anchor, so Jan 31 returns Mar 31 after Feb 28.
 * Skip anything due before forecast start and retain signed subscription cutoff. */
export function futureBillingDates(anchor:Date,from:Date,to:Date,max=12){
 if(!Number.isSafeInteger(max)||max<1||max>24||from>to)
  throw new BooksClosingError("Invalid forecast recurrence range.");
 const events:Date[]=[];
 for(let i=0;i<max;i++){
  const date=billingPeriodFor(anchor,i).start;
  if(date>=to)break;
  if(date>=from)events.push(date);
 }
 return events;
}
export function recurringDates(day:number,fromKey:string,throughKey:string){
 calendarKey(fromKey);calendarKey(throughKey);
 if(fromKey>throughKey)throw new BooksClosingError("Reversed recurring range.");
 const result:string[]=[];
 let month=fromKey.slice(0,7);const end=throughKey.slice(0,7);
 while(month<=end&&result.length<24){
  const due=monthDay(month,day);
  if(due>=fromKey&&due<=throughKey)result.push(due);
  month=nextCalendarMonth(month);
 }
 return result;
}
export function refundAdjustedCollection(payments:number,refunds:number) {
 if(whole(payments,"paid receipts")<0||whole(refunds,"refunds")<0)
  throw new BooksClosingError("Collection/refund amounts cannot be negative.");
 return add(payments,-refunds);
}
export function avgRentalMonths(rentals:{start:string;end:string}[]){
 let totalDays=0;
 for(const r of rentals){
  calendarKey(r.start);calendarKey(r.end);
  if(r.end<r.start)throw new BooksClosingError("Rental closed before it started.");
  totalDays+=Math.round((Date.parse(r.end)-Date.parse(r.start))/86400000)+1;
 }
 return rentals.length?Math.round(totalDays/rentals.length/30.4375*10)/10:null;
}
export type CashLine={date:string;kind:"BILLING_ESTIMATE"|"RECURRING_EXPENSE_ESTIMATE"|"TAX_WORKSHEET_ESTIMATE"|"BUDGET_PLAN_ESTIMATE";
 amountCents:number;sourceId:string;label:string;confidence:"ESTIMATE"|"NEEDS_REVIEW"};
export function cashTotals(rows:CashLine[]){
 let inflowCents=0,outflowCents=0;
 for(const row of rows){calendarKey(row.date);whole(row.amountCents,"forecast");
  if(row.kind==="BILLING_ESTIMATE")inflowCents=add(inflowCents,row.amountCents);
  else outflowCents=add(outflowCents,row.amountCents);
 }
 return {inflowCents,outflowCents,netCents:add(inflowCents,-outflowCents)};
}
