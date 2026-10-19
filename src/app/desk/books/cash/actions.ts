"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { registerCashAccount,setCashMatchWindow } from "@/domains/books/cash/accounts";
import { recordBookCashEvent,voidBookCashEvent } from "@/domains/books/cash/events";
import { attachBankStatement } from "@/domains/books/cash/evidence";
import { CASH_EVENT_KINDS,type CashEventKind } from "@/domains/books/cash/event-plan";

const str=(f:FormData,k:string)=>String(f.get(k)??"").trim();
function done(message:string):never {
 revalidatePath("/desk/books/cash");
 redirect("/desk/books/cash?notice="+encodeURIComponent(message.slice(0,300)));
}
async function action(label:string,execute:()=>Promise<unknown>){
 let message="";
 try {await execute();message=label+" saved.";}
 catch(e){message=label+": "+(e instanceof Error?e.message:"Unable to save");}
 done(message);
}
export async function registerCashAccountAction(form:FormData){
 const session=await requireRole("OWNER");
 await action("Bank evidence source",()=>registerCashAccount(session.user.id,{
  ledgerAccountId:str(form,"ledgerAccountId"),
  name:str(form,"name"),institutionLabel:str(form,"institutionLabel"),
  lastFour:str(form,"lastFour"),
 }));
}
export async function setCashMatchWindowAction(form:FormData){
 const session=await requireRole("OWNER");
 await action("Bank match window",()=>setCashMatchWindow(session.user.id,
  str(form,"cashAccountId"),Number(str(form,"version")),Number(str(form,"days"))));
}
export async function createCashEventAction(form:FormData){
 const session=await requireRole("OWNER");
 const kind=str(form,"kind") as CashEventKind;
 if(!CASH_EVENT_KINDS.includes(kind))return done("Unknown cash movement type.");
 await action("Cash journal source",()=>recordBookCashEvent(session.user.id,
  str(form,"commandKey"),{
   kind,amountCents:parseDollarInput(str(form,"amount"),1_000_000_000),
   occurredDate:str(form,"occurredDate"),
   fromLedgerAccountId:str(form,"fromLedgerAccountId")||null,
   toLedgerAccountId:str(form,"toLedgerAccountId")||null,
   sourceReceiptIds:str(form,"receiptIds").split(",").map(v=>v.trim()).filter(Boolean),
   memo:str(form,"memo"),
  }));
}
export async function voidCashEventAction(form:FormData){
 const session=await requireRole("OWNER");
 await action("Cash event reversal",()=>voidBookCashEvent(session.user.id,str(form,"id"),
   Number(str(form,"version")),str(form,"commandKey"),str(form,"reason")));
}
export async function attachBankStatementAction(form:FormData){
 const session=await requireRole("OWNER","ADMIN");
 await action("Private bank statement",()=>attachBankStatement(session.user.id,
   str(form,"importId"),str(form,"url")));
}
