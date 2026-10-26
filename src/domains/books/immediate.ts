import { Prisma, type JournalSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue } from "@/domains/system-issues";
import { postForSource } from "./post";

/** Best-effort short posting after the operational money transaction has committed. */
export async function postBookSourceAfterCommit(sourceType:JournalSourceType,sourceId:string):Promise<void>{
 try{
  await prisma.$transaction(tx=>postForSource(tx,sourceType,sourceId),
   {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }catch{
  // The money action succeeded already. Leave this source for tonight and a visible issue.
  try{await recordSystemIssue({kind:"BOOKS_POSTING_FAILURE",sourceType,sourceId});}
  catch{console.error("[books] Could not record a background books issue.");}
 }
}

/**
 * A Stripe paid-invoice webhook has already committed its local invoice, receipt
 * and allocation records when this runs. We look up those durable local IDs,
 * never trust caller-provided cents or an unverified provider object for a journal.
 */
export async function postPaidInvoiceAfterWebhook(stripeInvoiceId:string):Promise<void>{
 try{
  const invoice=await prisma.invoice.findUnique({where:{stripeInvoiceId},select:{id:true}});
  if(!invoice)return;
  const receipts=await prisma.receipt.findMany({
   where:{payments:{some:{invoiceId:invoice.id}}},
   orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true},take:20,
  });
  for(const receipt of receipts)await postBookSourceAfterCommit("RECEIPT",receipt.id);
  await postBookSourceAfterCommit("INVOICE",invoice.id);
 }catch{
  try{await recordSystemIssue({kind:"BOOKS_POSTING_FAILURE",sourceType:"INVOICE",sourceId:stripeInvoiceId});}
  catch{console.error("[books] Could not record a webhook Books issue.");}
 }
}
