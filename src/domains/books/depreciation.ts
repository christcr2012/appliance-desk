import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

export class BookAssetInputError extends Error {}
export type DepreciationRow = { periodKey: string; amountCents: number };
const whole=(n:number,label:string)=>{if(!Number.isSafeInteger(n)||n<0)throw new BookAssetInputError("Invalid "+label+" cents.");return n;};
export const monthKey=(s:string)=>{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new BookAssetInputError("Invalid Colorado accounting month.");
 return s;
};
export function nextMonth(s:string):string{
 const k=monthKey(s),[year,month]=k.split("-").map(Number);
 return new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);
}
export function lastBusinessDay(s:string):Date{
 const k=monthKey(s),[year,month]=k.split("-").map(Number);
 const last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 return businessDateFromKey(last)!;
}
export function lastCompletedMonth(now:Date=new Date()):string{
 const [year,month]=businessDateKey(now).slice(0,7).split("-").map(Number);
 return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
}
/** First depreciation month follows purchase/placed-in-service month.
 * Whole-cent rounding remains inside the last month, never carried to tax depreciation. */
export function monthlySchedule(input:{costCents:number;salvagePercent:number;months:number;startMonth:string}):DepreciationRow[]{
 const cost=whole(input.costCents,"asset cost");
 if(!cost||!Number.isInteger(input.months)||input.months<1||input.months>360||
   !Number.isInteger(input.salvagePercent)||input.salvagePercent<0||input.salvagePercent>95)
  throw new BookAssetInputError("Management book life must be 1–360 months and salvage 0–95%.");
 monthKey(input.startMonth);
 const salvage=Math.round(cost*input.salvagePercent/100);
 const depreciable=cost-salvage,each=Math.floor(depreciable/input.months);
 const results:DepreciationRow[]=[];let month=input.startMonth;
 for(let n=0;n<input.months;n++){
  results.push({periodKey:month,amountCents:n===input.months-1?depreciable-each*(input.months-1):each});
  month=nextMonth(month);
 }
 return results;
}
/** After an owner changes useful life, immutable prior journals remain.
 * The remaining cost is recomputed over only the unposted months. */
export function remainingSchedule(input:{
 costCents:number;salvagePercent:number;months:number;
 postedCents:number;postedMonths:number;nextUnpostedMonth:string;
}):DepreciationRow[]{
 const {costCents,salvagePercent,months,postedCents,postedMonths,nextUnpostedMonth}=input;
 whole(postedCents,"posted depreciation");
 if(!Number.isInteger(postedMonths)||postedMonths<0||postedMonths>360)
  throw new BookAssetInputError("Invalid already-depreciated month count.");
 const original=monthlySchedule({costCents,salvagePercent,months,startMonth:nextUnpostedMonth});
 const target=original.reduce((n,r)=>n+r.amountCents,0);
 if(postedCents>target)
  throw new BookAssetInputError("Previously booked depreciation already exceeds the proposed depreciable value.");
 const remaining=months-postedMonths;
 if(remaining<0 || (remaining===0&&target!==postedCents))
  throw new BookAssetInputError("Proposed useful life cannot fit existing posted months.");
 if(!remaining)return [];
 const amount=target-postedCents,each=Math.floor(amount/remaining);
 const result:DepreciationRow[]=[];let month=monthKey(nextUnpostedMonth);
 for(let n=0;n<remaining;n++){
  result.push({periodKey:month,amountCents:n===remaining-1?amount-each*(remaining-1):each});
  month=nextMonth(month);
 }
 return result;
}
