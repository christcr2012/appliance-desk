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

/**
 * A successful signed Checkout event is not sufficient payment evidence by itself.
 * Read only locally committed invoice/payment IDs after the webhook has finished.
 */
export async function postCheckoutPaymentAfterWebhook(stripePaymentIntentId:string):Promise<void>{
 try{
  const payments=await prisma.payment.findMany({
   where:{stripePaymentIntentId},
   select:{receiptId:true,invoiceId:true},
  });
  const receipts=new Set(payments.map(p=>p.receiptId).filter((x):x is string=>Boolean(x)));
  const invoices=new Set(payments.map(p=>p.invoiceId));
  for(const receiptId of receipts)await postBookSourceAfterCommit("RECEIPT",receiptId);
  for(const invoiceId of invoices)await postBookSourceAfterCommit("INVOICE",invoiceId);
 }catch{
  try{await recordSystemIssue({kind:"BOOKS_POSTING_FAILURE",sourceType:"RECEIPT",sourceId:stripePaymentIntentId});}
  catch{console.error("[books] Could not record a Checkout books issue.");}
 }
}

/** Stripe refunds are journaled only when matched to refund rows saved by the webhook. */
export async function postRefundsAfterWebhook(stripeRefundIds:string[]):Promise<void>{
 if(!stripeRefundIds.length)return;
 try{
  const refunds=await prisma.refund.findMany({
   where:{stripeRefundId:{in:stripeRefundIds}},
   select:{id:true},
  });
  for(const refund of refunds)await postBookSourceAfterCommit("REFUND",refund.id);
 }catch{
  try{await recordSystemIssue({kind:"BOOKS_POSTING_FAILURE",sourceType:"REFUND",sourceId:stripeRefundIds[0]!});}
  catch{console.error("[books] Could not record a refund books issue.");}
 }
}
