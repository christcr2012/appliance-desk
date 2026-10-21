"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { attestBudgetSources,setBudgetActivation } from "@/domains/budget/protected";
import { applyBudgetMoves,undoBudgetMove } from "@/domains/budget/moves";
import { configureBudgetEnvelope,configureBudgetWindows } from "@/domains/budget/envelopes";
import { assignPostedBankSpending,reversePostedBankSpending,returnClearedSupplierRefund } from "@/domains/budget/spending";
import { saveBudgetCostPlan,saveBudgetTarget,settleBudgetCost,reverseBudgetCostSettlement,getBudgetPlanning } from "@/domains/budget/planning";
import type { BudgetRecurrence,BudgetTargetKind } from "@/domains/budget/planning-math";
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

export async function assignSpendingAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Existing Books expense classification",()=>assignPostedBankSpending(s.user.id,{
  journalLineId:str(f,"journalLineId"),commandKey:str(f,"key")||randomUUID(),
  reason:str(f,"reason"),splits:[{envelopeId:str(f,"envelopeId"),
   amountCents:parseDollarInput(str(f,"amount"),2_000_000_000)}]}));
}
export async function reverseSpendingAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Posted expense classification correction",()=>reversePostedBankSpending(s.user.id,{
  journalLineId:str(f,"journalLineId"),expectedRevision:str(f,"revision"),
  commandKey:str(f,"key")||randomUUID(),reason:str(f,"reason")}));
}

export async function editEnvelopeAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Envelope details",()=>configureBudgetEnvelope(s.user.id,{
  envelopeId:str(f,"envelopeId"),expectedVersion:Number(str(f,"version")),
  name:str(f,"name"),groupLabel:str(f,"groupLabel"),sortOrder:Number(str(f,"sortOrder")),
  active:str(f,"active")==="true",reason:str(f,"reason")}));
}
export async function configureWindowsAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Review windows",()=>configureBudgetWindows(s.user.id,{
  bankEvidenceMaxAgeDays:Number(str(f,"bankAge")),
  budgetPlanningHorizonDays:Number(str(f,"horizon")),
  budgetUpcomingWindowDays:Number(str(f,"upcoming")),
  budgetReminderLeadDays:Number(str(f,"lead")),
  expectedRevision:str(f,"revision"),reason:str(f,"reason")}));
}
export async function transferBudgetAction(f:FormData){
 const s=await requireRole("OWNER"),from=str(f,"fromId"),to=str(f,"toId");
 await command("Envelope transfer",async()=>{
  if(!from||!to||from===to)throw new Error("Choose two distinct active envelopes.");
  const amount=parseDollarInput(str(f,"amount"),2_000_000_000);
  if(!amount)throw new Error("A positive amount is required.");
  return applyBudgetMoves(s.user.id,{
   asOf:str(f,"asOf"),expectedRevision:str(f,"revision"),sourceHash:str(f,"hash"),
   commandKey:str(f,"key")||randomUUID(),reason:str(f,"reason"),
   moves:[{envelopeId:from,kind:"RELEASE",signedCents:-amount},
    {envelopeId:to,kind:"ASSIGN",signedCents:amount}]});
 });
}

export async function applyRefundAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Cleared original supplier refund",()=>returnClearedSupplierRefund(s.user.id,{
  refundBankJournalLineId:str(f,"refundLineId"),originalSpendMoveId:str(f,"originalSpendId"),
  amountCents:parseDollarInput(str(f,"amount"),2_000_000_000),
  expectedRevision:str(f,"revision"),commandKey:str(f,"key")||randomUUID(),
  reason:str(f,"reason")}));
}

export async function saveBudgetCostPlanAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Known future bill",()=>saveBudgetCostPlan(s.user.id,{
  envelopeId:str(f,"envelopeId"),planId:str(f,"planId")||undefined,
  expectedVersion:str(f,"version")?Number(str(f,"version")):undefined,
  name:str(f,"name"),amountCents:parseDollarInput(str(f,"amount"),2_000_000_000),
  amountQuality:str(f,"quality")==="EXACT"?"EXACT":"ESTIMATE",
  dueOn:str(f,"dueOn"),
  recurrence:(str(f,"recurrence")||"NONE") as BudgetRecurrence,
  sourceType:"MANUAL",active:str(f,"active")!=="false",reason:str(f,"reason")}));
}
export async function saveBudgetTargetAction(f:FormData){
 const s=await requireRole("OWNER");
 const kind=str(f,"kind") as BudgetTargetKind;
 await command("Savings target",()=>saveBudgetTarget(s.user.id,{
  envelopeId:str(f,"envelopeId"),
  expectedVersion:str(f,"version")?Number(str(f,"version")):undefined,
  kind,
  amountCents:parseDollarInput(str(f,"amount"),2_000_000_000),
  dueOn:kind==="SAVE_BY_DATE"?(str(f,"dueOn")||null):null,
  repeat:kind==="SAVE_BY_DATE"&&str(f,"repeat")==="ANNUAL"?"ANNUAL":"NONE",
  active:true,reason:str(f,"reason")}));
}
export async function settleBudgetCostAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Posted Books expense link",()=>settleBudgetCost(s.user.id,{
  occurrenceId:str(f,"occurrenceId"),expenseId:str(f,"expenseId"),
  amountCents:parseDollarInput(str(f,"amount"),2_000_000_000),
  commandKey:str(f,"key")||randomUUID(),expectedRevision:str(f,"revision"),
  reason:str(f,"reason")}));
}
export async function reverseBudgetCostAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Posted payment link correction",()=>reverseBudgetCostSettlement(s.user.id,{
  settlementId:str(f,"settlementId"),expectedRevision:str(f,"revision"),
  commandKey:str(f,"key")||randomUUID(),reason:str(f,"reason")}));
}
export async function fundBudgetSuggestionAction(f:FormData){
 const s=await requireRole("OWNER");
 await command("Verified-cash funding plan",async()=>{
  const asOf=str(f,"asOf"),view=await getBudgetPlanning(s.user.id,asOf);
  if(!view.mayAssign||view.revision!==str(f,"revision")||
     view.sourceHash!==str(f,"hash")||
     !view.proposal.legs.length||
     JSON.stringify(view.proposal.legs.map(l=>({envelopeId:l.envelopeId,
      signedCents:l.signedCents})))!==str(f,"legs"))
   throw new Error("Current protected source or funding plan changed. Review again before confirming.");
  return applyBudgetMoves(s.user.id,{asOf,sourceHash:view.sourceHash,
   expectedRevision:view.revision,commandKey:str(f,"key")||randomUUID(),
   reason:str(f,"reason"),moves:view.proposal.legs.map(l=>({
    envelopeId:l.envelopeId,kind:"ASSIGN" as const,signedCents:l.signedCents}))});
 });
}
