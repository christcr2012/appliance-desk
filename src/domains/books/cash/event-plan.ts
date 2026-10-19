import { balancedPlan, reversePlan, type PostingPlan } from "@/domains/books/posting-rules";

export const CASH_EVENT_KINDS=[
 "OWNER_CONTRIBUTION","OWNER_DRAW","BANK_TRANSFER","BANK_INTEREST","CARD_PAYMENT","CASH_DEPOSIT",
] as const;
export type CashEventKind=(typeof CASH_EVENT_KINDS)[number];
export type CashPlanInput={
 kind:string;amountCents:number;occurredOn:Date;memo:string;
 fromLedgerAccountId:string|null;toLedgerAccountId:string|null;reversalOfId:string|null;
};
const debit=(role:string,cents:number)=>({role,debitCents:cents,creditCents:0});
const credit=(role:string,cents:number)=>({role,debitCents:0,creditCents:cents});
const external=(id:string|null,label:string)=>{
 if(!id||!/^[A-Za-z0-9_-]{4,150}$/.test(id))throw new Error("Missing verified "+label+" account identity.");
 return "ID:"+id;
};
export function cashEventPlan(e:CashPlanInput):PostingPlan {
 if(!CASH_EVENT_KINDS.some(kind=>kind===e.kind))
  throw new Error("Unsupported typed cash event.");
 if(!Number.isSafeInteger(e.amountCents)||e.amountCents<=0||e.amountCents>1_000_000_000)
  throw new Error("Cash amount must be positive whole cents.");
 if(!e.memo.trim()||e.memo.length>300)throw new Error("A dated source explanation is required.");
 const amt=e.amountCents,from=e.fromLedgerAccountId,to=e.toLedgerAccountId;
 let lines;
 switch(e.kind as CashEventKind){
  case "OWNER_CONTRIBUTION":
   if(from)throw new Error("Owner contributions have no unverified origin bank account.");
   lines=[debit(external(to,"destination bank"),amt),credit("OWNER_CONTRIBUTIONS",amt)];break;
  case "OWNER_DRAW":
   if(to)throw new Error("Owner draws are not business-bank transfers.");
   lines=[debit("OWNER_DRAWS",amt),credit(external(from,"business bank"),amt)];break;
  case "BANK_TRANSFER":
   if(!from||!to||from===to)throw new Error("A transfer requires two distinct verified business banks.");
   lines=[debit(external(to,"receiving bank"),amt),credit(external(from,"sending bank"),amt)];break;
  case "BANK_INTEREST":
   if(from)throw new Error("Interest has no sending business bank.");
   lines=[debit(external(to,"receiving bank"),amt),credit("INTEREST_INCOME",amt)];break;
  case "CARD_PAYMENT":
   if(to)throw new Error("Card payments use the known card liability, not a target bank.");
   lines=[debit("CARD",amt),credit(external(from,"paying bank"),amt)];break;
  case "CASH_DEPOSIT":
   if(from)throw new Error("Deposited cash/check receipts originate in UNDEPOSITED.");
   lines=[debit(external(to,"depositing bank"),amt),credit("UNDEPOSITED",amt)];break;
 }
 const normal=balancedPlan(e.occurredOn,e.memo,lines);
 if(!normal)throw new Error("Typed cash event has no balanced journal.");
 return e.reversalOfId?reversePlan(normal,e.occurredOn,"Voided cash event: "+e.memo.slice(0,200)):normal;
}
