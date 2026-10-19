import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { CashEvidenceError } from "./accounts";
import { createHash } from "node:crypto";

export type CashMovement={
 signedCents:number;entryDate:string;clearedObservationDates:string[];
};
export type CashReadinessComponents={
 endingCents:number;cutoff:string;asOf:string;movements:CashMovement[];
 holdsCents:number;
};
const safe=(n:number)=>{if(!Number.isSafeInteger(n))throw new CashEvidenceError("Unsafe cash evidence.");return n;};
/** Statement already contains earlier cleared money. Every journal outflow is
 * counted only once; later credit-cleared inflows do not become new income. */
export function computeConservativeBankCash(i:CashReadinessComponents){
 const valid=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
 if(!valid(i.cutoff)||!valid(i.asOf)||i.cutoff>i.asOf)
  throw new CashEvidenceError("Cash cutoff must precede its Colorado as-of date.");
 let laterClearedIn=0,laterOutflows=0,priorOutstandingOut=0,priorNowClearedIn=0;
 for(const m of i.movements){
  const amount=safe(m.signedCents),clearDates=m.clearedObservationDates;
  if(clearDates.some(x=>!valid(x)))throw new CashEvidenceError("Invalid bank observation date.");
  const clearedBefore=clearDates.some(d=>d<=i.cutoff);
  const clearedAfter=clearDates.some(d=>d>i.cutoff && d<=i.asOf);
  if(m.entryDate>i.asOf)continue;
  if(m.entryDate>i.cutoff){
   if(amount<0)laterOutflows+=-amount;
   else if(amount>0&&clearedAfter)laterClearedIn+=amount;
  }else {
   if(amount<0&&!clearedBefore)priorOutstandingOut+=-amount;
   if(amount>0&&!clearedBefore&&clearedAfter)priorNowClearedIn+=amount;
  }
 }
 const held=safe(i.holdsCents),ending=safe(i.endingCents);
 if(held<0)throw new CashEvidenceError("Cash holds cannot be negative.");
 const result=ending+laterClearedIn-laterOutflows-priorOutstandingOut+priorNowClearedIn-held;
 if(!Number.isSafeInteger(result))throw new CashEvidenceError("Cash evidence overflows safe cents.");
 return {endingCents:ending,laterClearedInCents:safe(laterClearedIn),
  laterBookedOutflowsCents:safe(laterOutflows),priorOutstandingOutflowsCents:safe(priorOutstandingOut),
  priorClearedInflowCents:safe(priorNowClearedIn),unreleasedHoldsCents:held,
  provisionalCents:result};
}
type Evidence={schemaVersion?:unknown;sha256?:unknown;confirmedCompleteThrough?:unknown};
const digest=(obj:Record<string,unknown>)=>createHash("sha256").update(JSON.stringify(obj)).digest("hex");
export async function readBankCashReadiness(userId:string,asOfKey=businessDateKey(new Date())){
 const asOf=businessDateFromKey(asOfKey);
 if(!asOf||businessDateKey(asOf)!==asOfKey||asOfKey>businessDateKey(new Date()))
  throw new CashEvidenceError("Choose a past or current Colorado cash date.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const accounts=await tx.cashAccount.findMany({where:{active:true},
   select:{id:true,name:true,ledgerAccountId:true,lastFour:true,bankMatchWindowDays:true},
   orderBy:{name:"asc"},take:100});
  const results=[];
  for(const account of accounts){
   const reconciliation=await tx.bankReconciliation.findFirst({where:{
    cashAccountId:account.id,status:"COMPLETED",isCurrent:true,toOn:{lte:asOf},
   },orderBy:{toOn:"desc"},select:{
    id:true,toOn:true,beginningCents:true,endingCents:true,includedEvidence:true,
   }});
   if(!reconciliation){
    results.push({id:account.id,name:account.name,lastFour:account.lastFour,
     status:"UNKNOWN" as const,reasons:["No current completed owner-attested bank reconciliation."],
     components:null,cutoff:null});
    continue;
   }
   const cutoff=businessDateKey(reconciliation.toOn);
   const evidence=reconciliation.includedEvidence as Evidence|null;
   const reasons:string[]=[];
   if(!evidence||evidence.schemaVersion!==1||typeof evidence.sha256!=="string"){
    reasons.push("Completed statement snapshot has no verifiable SHA-256 evidence.");
   }else{
    const {sha256,...data}=evidence as Record<string,unknown>;
    if(digest(data)!==sha256)reasons.push("Completed bank snapshot failed integrity verification.");
   }
   if(cutoff<asOfKey)
    reasons.push("Bank evidence is not complete through the requested cash date; confirm the next statement/import-through period.");
   const observations=await tx.bankObservation.findMany({where:{
    cashAccountId:account.id,isActive:true,postedOn:{lte:asOf},
    status:{in:["UNMATCHED","SUPERSEDED"]},
   },select:{id:true},take:1});
   if(observations.length)reasons.push("Unresolved imported bank activity remains unclassified or unmatched.");
   const bankLines=await tx.journalLine.findMany({where:{
    ledgerAccountId:account.ledgerAccountId,entry:{entryDate:{lte:asOf}},
   },include:{entry:{select:{entryDate:true}},
    bankMatchItems:{where:{active:true},include:{group:{select:{voidedAt:true,
     items:{where:{active:true,bankObservationId:{not:null}},
      include:{observation:{select:{postedOn:true,isActive:true}}}}}}}},
   },take:10001});
   if(bankLines.length>10000){
    results.push({id:account.id,name:account.name,lastFour:account.lastFour,
     status:"UNKNOWN" as const,reasons:["More than 10,000 journal bank lines; narrower source review required."],
     components:null,cutoff});
    continue;
   }
   const holds=await tx.cashHold.findMany({where:{cashAccountId:account.id,
    effectiveOn:{lte:asOf},OR:[{releasedAt:null},{releasedAt:{gt:asOf}}],
   },select:{amountCents:true},take:10001});
   if(holds.length>10000)reasons.push("Cash hold records exceed safe review window.");
   const held=holds.reduce((a,h)=>a+h.amountCents,0);
   const movements:CashMovement[]=bankLines.map(line=>({
    signedCents:line.debitCents-line.creditCents,entryDate:businessDateKey(line.entry.entryDate),
    clearedObservationDates:[...new Set(line.bankMatchItems.filter(m=>!m.group.voidedAt)
     .flatMap(m=>m.group.items.filter(i=>i.observation?.isActive)
       .map(i=>businessDateKey(i.observation!.postedOn))))],
   }));
   const components=computeConservativeBankCash({
    endingCents:reconciliation.endingCents,cutoff,asOf:asOfKey,movements,holdsCents:held,
   });
   if(components.provisionalCents<0)reasons.push("Conservative net cash is negative.");
   // Bank matches alone cannot prove unknown card obligations or other reserve liabilities.
   reasons.push("Source cash evidence is not permission to fund budgets; protected liabilities require K-CASH-4B.");
   results.push({id:account.id,name:account.name,lastFour:account.lastFour,
    status:reasons.some(x=>/failed|No |negative|not complete|Unresolved|exceed/i.test(x))?
      "BLOCKED" as const:"PROVISIONAL" as const,
    reasons,components,cutoff});
  }
  const observed=results.reduce((n,r)=>n+(r.components?.provisionalCents??0),0);
  if(!Number.isSafeInteger(observed))throw new CashEvidenceError("Combined cash evidence is unsafe.");
  return {asOf:asOfKey,accounts:results,provisionalTotalCents:observed,
   assignableCents:0,scope:"READ_ONLY_EVIDENCE" as const,
   globalReasons:["Protected taxes/deposits/card liabilities and envelope funding are not yet completed in K-CASH-4B.",
    "This is not a real-time bank connection or permission to pay."]};
 });
}
