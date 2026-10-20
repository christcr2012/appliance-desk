"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { confirmBankMatch,ignoreBankObservation,voidBankMatch } from "@/domains/books/cash/matches";
import { createBankReconciliation,completeBankReconciliation,
 reopenBankReconciliation } from "@/domains/books/cash/reconcile";
import { createCashHold,releaseCashHold } from "@/domains/books/cash/cash-readiness";

const field=(f:FormData,key:string)=>String(f.get(key)??"").trim();
const number=(f:FormData,key:string)=>Number(field(f,key));
const money=(f:FormData,key:string)=>parseDollarInput(field(f,key),2_000_000_000);
const signedMoney=(f:FormData,key:string)=>{
 const input=field(f,key);
 if(!/^-?(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(input))
  throw new Error("Enter a signed whole-cent amount in dollars.");
 const neg=input.startsWith("-");
 const value=parseDollarInput(neg?input.slice(1):input,2_000_000_000);
 return neg?-value:value;
};
const choices=(f:FormData,key:string)=>f.getAll(key).map(x=>String(x));
function finish(accountId:string,message:string):never{
 revalidatePath("/desk/books/cash/checks");
 redirect("/desk/books/cash/checks?accountId="+encodeURIComponent(accountId)+
   "&notice="+encodeURIComponent(message.slice(0,240)));
}
async function command(accountId:string,name:string,cb:()=>Promise<unknown>){
 let message:string;
 try{await cb();message=name+" saved.";}
 catch(e){message=name+": "+(e instanceof Error?e.message:"Unable to save");}
 finish(accountId,message);
}
export async function confirmMatchAction(form:FormData){
 const user=await requireRole("OWNER","ADMIN"),accountId=field(form,"accountId");
 await command(accountId,"Match",()=>confirmBankMatch(user.user.id,{
  accountId,observationIds:choices(form,"observationIds"),journalLineIds:choices(form,"journalLineIds"),
  observationVersions:Object.fromEntries(choices(form,"observationVersions")
   .map(x=>x.split(":")).filter(x=>x.length===2).map(([id,version])=>[id,Number(version)])),
  commandKey:field(form,"commandKey")||randomUUID()
 }));
}
export async function voidMatchAction(form:FormData){
 const user=await requireRole("OWNER","ADMIN"),accountId=field(form,"accountId");
 await command(accountId,"Void match",()=>voidBankMatch(user.user.id,
   field(form,"groupId"),number(form,"version"),field(form,"reason")));
}
export async function ignoreObservationAction(form:FormData){
 const user=await requireRole("OWNER"),accountId=field(form,"accountId");
 await command(accountId,"Ignore duplicate/non-account bank row",()=>ignoreBankObservation(user.user.id,
   field(form,"observationId"),number(form,"version"),
   field(form,"classification") as "DUPLICATE"|"NON_ACCOUNT",field(form,"reason")));
}
export async function draftStatementAction(form:FormData){
 const user=await requireRole("OWNER"),accountId=field(form,"accountId");
 await command(accountId,"Statement draft",()=>createBankReconciliation(user.user.id,{
  accountId,fromDate:field(form,"fromDate"),toDate:field(form,"toDate"),
  statementSourceReference:field(form,"statementSourceReference"),
  confirmedThroughDate:field(form,"confirmedThroughDate")==="confirmed",
  beginningCents:signedMoney(form,"beginning"),endingCents:signedMoney(form,"ending"),
  firstStatement:field(form,"sourceReference")?{
   sourceReference:field(form,"sourceReference"),
   bookBeginningCents:signedMoney(form,"bookBeginning"),
   preStartOutstandingCents:signedMoney(form,"outstanding")
  }:undefined
 }));
}
export async function completeStatementAction(form:FormData){
 const user=await requireRole("OWNER"),accountId=field(form,"accountId");
 await command(accountId,"Statement reconciliation",()=>completeBankReconciliation(
  user.user.id,field(form,"statementId"),number(form,"version")));
}
export async function reopenStatementAction(form:FormData){
 const user=await requireRole("OWNER"),accountId=field(form,"accountId");
 await command(accountId,"Statement reopen",()=>reopenBankReconciliation(
  user.user.id,field(form,"statementId"),number(form,"version"),field(form,"reason")));
}
export async function addCashHoldAction(form:FormData){
 const user=await requireRole("OWNER"),accountId=field(form,"accountId");
 await command(accountId,"Cash hold",()=>createCashHold(user.user.id,{
  accountId,amountCents:money(form,"amount"),effectiveDate:field(form,"effectiveDate"),
  reason:field(form,"reason")}));
}
export async function releaseCashHoldAction(form:FormData){
 const user=await requireRole("OWNER"),accountId=field(form,"accountId");
 await command(accountId,"Release cash hold",()=>releaseCashHold(user.user.id,
   field(form,"holdId"),number(form,"version"),field(form,"reason")));
}
