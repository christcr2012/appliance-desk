"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { attestBudgetSources,setBudgetActivation } from "@/domains/budget/protected";
import { applyBudgetMoves,undoBudgetMove } from "@/domains/budget/moves";
const str=(f:FormData,k:string)=>String(f.get(k)??"").trim();
const done=(message:string):never=>{
 revalidatePath("/desk/books/budget");
 redirect("/desk/books/budget?notice="+encodeURIComponent(message.slice(0,240)));
};
async function command(name:string,action:()=>Promise<unknown>){
 let message:string;
 try{await action();message=name+" recorded.";}
 catch(e){message=name+": "+(e instanceof Error?e.message:"Unable to save");}
 done(message);
}
export async function attestBudgetAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Source review",()=>attestBudgetSources(s.user.id,{
  asOf:str(f,"asOf"),expectedRevision:str(f,"revision"),
  bankSourceReference:str(f,"bankReference"),cardSourceReference:str(f,"cardReference"),
  liabilitySourceReference:str(f,"liabilityReference"),
  confirmAll:str(f,"confirmed")==="confirmed"}));
}
export async function activateBudgetAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Budget setup",()=>setBudgetActivation(s.user.id,{
  enabled:str(f,"enabled")==="true",startDate:str(f,"date"),
  expectedRevision:str(f,"revision"),reason:str(f,"reason")}));
}
export async function budgetMoveAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Envelope movement",()=>applyBudgetMoves(s.user.id,{
  asOf:str(f,"asOf"),expectedRevision:str(f,"revision"),
  sourceHash:str(f,"hash"),commandKey:str(f,"key")||randomUUID(),
  reason:str(f,"reason"),moves:[{envelopeId:str(f,"envelopeId"),
   kind:str(f,"kind")==="RELEASE"?"RELEASE":"ASSIGN",
   signedCents:(str(f,"kind")==="RELEASE"?-1:1)*parseDollarInput(str(f,"amount"),2_000_000_000)}]}));
}
export async function budgetUndoAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Undo allocation",()=>undoBudgetMove(s.user.id,{
  moveId:str(f,"moveId"),asOf:str(f,"asOf"),expectedRevision:str(f,"revision"),
  sourceHash:str(f,"hash"),reason:str(f,"reason"),commandKey:str(f,"key")||randomUUID()}));
}
