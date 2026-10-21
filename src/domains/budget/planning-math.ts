import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/**
 * All dates are Colorado civil dates. Generate each occurrence independently
 * from the original anchor, never by adding a month to a clamped date.
 * A plan is evidence of a future cost, NOT a posted payment or bank debit.
 */
export type BudgetRecurrence = "NONE" | "MONTHLY" | "QUARTERLY" | "ANNUAL";
export type BudgetTargetKind = "MONTHLY_SPEND" | "SAVE_BY_DATE" | "MAINTAIN_BALANCE";
export class BudgetPlanError extends Error {}

const cap=(value:number,label:string)=>{
 if(!Number.isSafeInteger(value)||Math.abs(value)>2_000_000_000)
  throw new BudgetPlanError(label+" must be safe whole cents.");
 return value;
};
const valid=(key:string)=>{
 const instant=businessDateFromKey(key);
 if(!instant||businessDateKey(instant)!==key)
  throw new BudgetPlanError("Choose a real Colorado calendar day.");
 return key;
};
const parts=(key:string)=>{
 valid(key);
 return {year:Number(key.slice(0,4)),month:Number(key.slice(5,7)),
  day:Number(key.slice(8,10))};
};
const monthIndex=(p:{year:number;month:number})=>p.year*12+p.month-1;
const monthDate=(index:number,anchor:number)=>{
 const y=Math.floor(index/12),m=index%12+1;
 const days=new Date(Date.UTC(y,m,0)).getUTCDate();
 return String(y).padStart(4,"0")+"-"+String(m).padStart(2,"0")+"-"+String(Math.min(anchor,days)).padStart(2,"0");
};
export function plannedDueKeys(input:{anchor:string;recurrence:BudgetRecurrence;
 from:string;through:string;max?:number}){
 const anchor=parts(input.anchor),from=parts(input.from),through=parts(input.through);
 const maximum=input.max??500;
 if(input.from>input.through||!Number.isSafeInteger(maximum)||maximum<1||maximum>500)
  throw new BudgetPlanError("Choose an ordered, bounded planning horizon.");
 if(!["NONE","MONTHLY","QUARTERLY","ANNUAL"].includes(input.recurrence))
  throw new BudgetPlanError("Unsupported cost recurrence.");
 if(input.recurrence==="NONE")
  return input.anchor>=input.from&&input.anchor<=input.through?[input.anchor]:[];
 const step=input.recurrence==="MONTHLY"?1:input.recurrence==="QUARTERLY"?3:12;
 const begin=monthIndex(anchor),end=monthIndex(through),first=monthIndex(from);
 const start=Math.max(0,Math.floor(Math.max(0,first-begin)/step)-1);
 const result:string[]=[];
 for(let k=start;begin+k*step<=end;k++){
  const date=monthDate(begin+k*step,anchor.day);
  if(date<input.anchor||date<input.from||date>input.through)continue;
  if(result.length===maximum)throw new BudgetPlanError("Planning horizon has too many occurrences.");
  result.push(date);
 }
 return result;
}
export function suggestedTarget(input:{kind:BudgetTargetKind;amountCents:number;
 balanceCents:number;netSpentThisMonthCents:number;today:string;dueOn?:string|null;
 repeat?:"NONE"|"ANNUAL"}){
 cap(input.amountCents,"Target");cap(input.balanceCents,"Saved money");
 cap(input.netSpentThisMonthCents,"Spending");
 if(input.amountCents<=0)throw new BudgetPlanError("Target must be greater than zero.");
 valid(input.today);
 const balance=Math.max(0,input.balanceCents);
 if(input.kind==="MONTHLY_SPEND"){
  const needed=Math.max(0,cap(input.amountCents-input.netSpentThisMonthCents-balance,"Monthly need"));
  return {neededCents:needed,suggestedPerMonthCents:needed,nextDueOn:null};
 }
 if(input.kind==="MAINTAIN_BALANCE"){
  const needed=Math.max(0,input.amountCents-balance);
  return {neededCents:needed,suggestedPerMonthCents:needed,nextDueOn:null};
 }
 if(input.kind!=="SAVE_BY_DATE"||!input.dueOn)
  throw new BudgetPlanError("A savings goal requires a due date.");
 let due=input.dueOn;
 valid(due);
 if(input.repeat==="ANNUAL"&&due<input.today){
  const original=parts(due),current=parts(input.today);
  const yearDelta=current.year-original.year;
  due=monthDate(monthIndex(original)+Math.max(0,yearDelta)*12,original.day);
  if(due<input.today)due=monthDate(monthIndex(original)+(yearDelta+1)*12,original.day);
 }
 const current=parts(input.today),end=parts(due);
 const months=Math.max(1,monthIndex(end)-monthIndex(current)+1);
 const needed=Math.max(0,input.amountCents-balance);
 return {neededCents:needed,suggestedPerMonthCents:Math.ceil(needed/months),nextDueOn:due};
}
/** Bills are obligations, not a second savings target. Never add both needs. */
export function fundNowNeed(input:{balanceCents:number;targetNeedCents:number;
 unpaidUpcomingCents:number}){
 const balance=cap(input.balanceCents,"Envelope balance");
 const target=cap(input.targetNeedCents,"Target need");
 const unpaid=cap(input.unpaidUpcomingCents,"Unpaid bills");
 if(target<0||unpaid<0)throw new BudgetPlanError("Need cannot be negative.");
 return Math.max(target,Math.max(0,unpaid-Math.max(0,balance)));
}
export type BudgetFundCandidate={id:string;currentCents:number;needCents:number;
 priority:"NEGATIVE"|"BILL"|"SAVE_BY_DATE"|"MONTHLY_SPEND"|"MAINTAIN_BALANCE";
 dueOn:string|null;sortOrder:number};
const ranks={NEGATIVE:0,BILL:1,SAVE_BY_DATE:2,MONTHLY_SPEND:3,MAINTAIN_BALANCE:4};
/** A preview is only a suggestion: the existing money domain must recheck all
 * cash/Books sources and lock the exact revision before any assignments. */
export function fundingSuggestion(candidates:BudgetFundCandidate[],readyCents:number|null){
 if(readyCents===null)return {legs:[],unfundedCents:null,why:"Verified available cash is unknown."};
 let available=Math.max(0,cap(readyCents,"Ready cash"));
 const list=[...candidates].sort((a,b)=>ranks[a.priority]-ranks[b.priority]||
  (a.dueOn??"9999-12-31").localeCompare(b.dueOn??"9999-12-31")||
  a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
 const used=new Set<string>(),legs:{envelopeId:string;signedCents:number;beforeCents:number;afterCents:number}[]=[];
 let unmet=0;
 for(const entry of list){
  if(used.has(entry.id))throw new BudgetPlanError("Duplicate envelope in funding preview.");
  used.add(entry.id);
  const prior=cap(entry.currentCents,"Envelope balance"),need=cap(entry.needCents,"Funding need");
  if(need<0)throw new BudgetPlanError("Funding need cannot be negative.");
  const funded=Math.min(need,available);
  unmet=cap(unmet+need-funded,"Unfunded total");
  available-=funded;
  if(funded>0)legs.push({envelopeId:entry.id,signedCents:funded,
   beforeCents:prior,afterCents:cap(prior+funded,"Proposed envelope")});
 }
 return {legs,unfundedCents:unmet,why:null};
}
