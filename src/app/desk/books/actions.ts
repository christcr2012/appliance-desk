"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import {
  initializeBooks, correctOpeningBalances, renameAccount, addCustomAccount, mapExportAccount,
  closeAccountingMonth, reopenAccountingMonth,
} from "@/domains/books/management";
import { postPending } from "@/domains/books/post";
import { runBooksAutopilot } from "@/domains/books/autopilot";
import type { LedgerAccountType, ExportTarget } from "@prisma/client";

const str=(form:FormData,key:string)=>String(form.get(key)??"");
const money=(form:FormData,key:string)=>{
  const value=str(form,key).trim();
  if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))throw new Error("Enter a valid money amount in dollars and cents.");
  const [whole,frac=""]=value.split(".");
  const cents=Number(whole)*100+Number(frac.padEnd(2,"0"));
  if(!Number.isSafeInteger(cents))throw new Error("Money amount is too large.");
  return cents;
};
function finish(action:string,message:string):never {
  revalidatePath("/desk/books");
  redirect("/desk/books?notice="+encodeURIComponent(action+": "+message));
}
async function handle(action:string, fn:()=>Promise<unknown>) {
  try { await fn(); }
  catch(e) { finish(action,e instanceof Error?e.message:"Unable to save accounting change"); }
  finish(action,"Saved");
}
const actor=(user:{id:string;role:string})=>({id:user.id,role:user.role as "OWNER"|"ADMIN"});
export async function initializeBooksAction(form:FormData) {
  const session=await requireRole("OWNER");
  await handle("Books setup",()=>initializeBooks(actor(session.user),{
    startDate:str(form,"startDate"),stripeCents:money(form,"stripe"),
    bankCents:money(form,"bank"),cardCents:money(form,"card"),
  }));
}
/** Only the owner can attest starting balances. No account values are guessed from Stripe. */
export async function startBooksWizardAction(form:FormData){
 const session=await requireRole("OWNER");
 const startDate=str(form,"startDate");
 const newBusiness=str(form,"newBusiness")==="yes";
 try{
  await initializeBooks(actor(session.user),{
   startDate,
   bankCents:newBusiness?0:money(form,"bank"),
   stripeCents:newBusiness?0:money(form,"stripe"),
   cardCents:newBusiness?0:money(form,"card"),
  });
 }catch(error){
  redirect("/desk/books/setup?notice="+encodeURIComponent(
   error instanceof Error?error.message:"Could not start your books."));
 }
 // Bookkeeping errors after the owner confirms may not reverse that confirmation.
 // A small, bounded first catch-up runs before redirect; nightly continues the rest.
 try{
  await runBooksAutopilot(new Date(),{maxSources:12,maxEnrollments:12,maxDepreciations:12});
 }catch(error){
  console.error("[books setup] First catch-up needs nightly retry",error instanceof Error?error.name:"Error");
 }
 revalidatePath("/desk/books");
 revalidatePath("/desk/today");
 redirect("/desk/books?notice="+encodeURIComponent(
  "Your books are started. Everything since "+startDate+" is being recorded."));
}
export async function correctOpeningBalancesAction(form:FormData){
 const session=await requireRole("OWNER");
 try{
  const result=await correctOpeningBalances(actor(session.user),{
   bankCents:money(form,"bank"),stripeCents:money(form,"stripe"),
   cardCents:money(form,"card"),reason:str(form,"reason"),
  });
  revalidatePath("/desk/books");
  redirect("/desk/books?notice="+encodeURIComponent(
    result.eventKind+": Starting balances corrected. The earlier entries were kept."));
 }catch(e){
  // Next.js redirects are thrown intentionally; only the database action is caught above.
  if(e&&typeof e==="object"&&"digest" in e)throw e;
  redirect("/desk/books?notice="+encodeURIComponent(
   e instanceof Error?e.message:"Could not correct starting balances."));
 }
}

export async function renameAccountAction(form:FormData) {
  const session=await requireRole("OWNER");
  await handle("Account name",()=>renameAccount(actor(session.user),str(form,"accountId"),str(form,"name")));
}
export async function createAccountAction(form:FormData) {
  const session=await requireRole("OWNER");
  await handle("New account",()=>addCustomAccount(actor(session.user),{
    name:str(form,"name"),description:str(form,"description"),
    type:str(form,"type") as LedgerAccountType,isPaymentSource:form.get("isPaymentSource")==="on",
  }));
}
export async function mapExportAccountAction(form:FormData) {
  const session=await requireRole("OWNER");
  await handle("Account mapping",()=>mapExportAccount(actor(session.user),{
    accountId:str(form,"accountId"),target:str(form,"target") as ExportTarget,
    externalName:str(form,"externalName"),externalTaxRate:str(form,"externalTaxRate"),
  }));
}
export async function postBooksAction() {
  await requireRole("OWNER","ADMIN");
  const result=await postPending({limit:500});
  finish("Journal",`${result.posted} entries recorded, ${result.problems.length} need review`);
}
export async function closeMonthAction(form:FormData) {
  const session=await requireRole("OWNER");
  await handle("Close month",()=>closeAccountingMonth(actor(session.user),str(form,"month")));
}
export async function reopenMonthAction(form:FormData) {
  const session=await requireRole("OWNER");
  await handle("Reopen month",()=>reopenAccountingMonth(actor(session.user),str(form,"month"),str(form,"reason")));
}
