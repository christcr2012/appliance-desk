"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { confirmBankMatch,voidBankMatch,ignoreBankObservation } from "@/domains/books/cash/matching";
import { completeBankReconciliation,reopenBankReconciliation } from "@/domains/books/cash/reconciliation";

const val=(f:FormData,k:string)=>String(f.get(k)??"").trim();
const list=(f:FormData,k:string)=>f.getAll(k).map(x=>String(x)).filter(Boolean);
const signed=(f:FormData,k:string)=>{
 const x=val(f,k),negative=x.startsWith("-");
 if(!x)throw new Error("Enter a signed bank balance.");
 return (negative?-1:1)*parseDollarInput(negative?x.slice(1):x,1_000_000_000);
};
const next=(accountId:string,message:string):never=>{
 revalidatePath("/desk/books/cash/checks");
 redirect("/desk/books/cash/checks?accountId="+encodeURIComponent(accountId)+
  "&notice="+encodeURIComponent(message.slice(0,450)));
};
async function performed(accountId:string,description:string,run:()=>Promise<unknown>){
 let result="";
 try{await run();result=description+" saved.";}
 catch(e){result=description+": "+(e instanceof Error?e.message:"Unable to save");}
 next(accountId,result);
}
export async function confirmBankMatchAction(form:FormData){
 const user=(await requireRole("OWNER","ADMIN")).user;
 const accountId=val(form,"accountId");
 await performed(accountId,"Bank match",()=>confirmBankMatch(user.id,{
  accountId,key:val(form,"key")||randomUUID(),
  observationIds:list(form,"observations"),journalLineIds:list(form,"journalLines"),
 }));
}
export async function voidBankMatchAction(form:FormData){
 const user=(await requireRole("OWNER","ADMIN")).user,accountId=val(form,"accountId");
 await performed(accountId,"Bank match reversal",()=>voidBankMatch(user.id,val(form,"id"),
  Number(val(form,"version")),val(form,"reason")));
}
export async function ignoreBankRowAction(form:FormData){
 const user=(await requireRole("OWNER")).user,accountId=val(form,"accountId");
 await performed(accountId,"Non-ledger row review",()=>ignoreBankObservation(user.id,val(form,"id"),
  Number(val(form,"version")),val(form,"kind") as "DUPLICATE"|"NON_ACCOUNT_ROW",
  val(form,"reason")));
}
export async function completeBankStatementAction(form:FormData){
 const user=(await requireRole("OWNER")).user,accountId=val(form,"accountId");
 await performed(accountId,"Bank statement",()=>completeBankReconciliation(user.id,{
  cashAccountId:accountId,accountVersion:Number(val(form,"accountVersion")),
  from:val(form,"from"),through:val(form,"through"),
  confirmedCompleteThrough:val(form,"completeThrough"),
  beginningCents:signed(form,"beginning"),endingCents:signed(form,"ending"),
  ownerConfirmedOpening:form.get("openingConfirmed")==="on",
  outstandingLineIds:list(form,"openingOutstanding"),sourceReference:val(form,"sourceReference"),
 }));
}
export async function reopenBankStatementAction(form:FormData){
 const user=(await requireRole("OWNER")).user,accountId=val(form,"accountId");
 await performed(accountId,"Bank statement reopening",()=>reopenBankReconciliation(user.id,
  val(form,"id"),Number(val(form,"version")),val(form,"reason")));
}
