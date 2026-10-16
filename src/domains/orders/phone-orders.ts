import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { assertAvailableDeliveryOption, deliverySelectionSchema,
  readOfferedSlots, type DeliverySelection } from "./delivery";
import { getPreparedEstimateQuote } from "@/domains/estimates/preapproval-quote";
import { sendEstimate } from "@/domains/estimates";

export const SUPPORT_REPLY_MAILBOX = "support@robinsonappliancerentals.com";
export type PhoneOrderView = {
  id: string;status:string;title:string;enteredByUserId:string;
  customerId:string|null;leadId:string|null;
  enteredAt:Date;preferred:DeliverySelection|null;offerVersion:number;
  slots:Array<{id:string;date:string;window:"AM"|"PM"}>;
  sentAt:Date|null;recipient:string|null;itemCount:number;
  selectedSource:"OWNER_PHONE_INPUT"|"NONE";
};
const allowedForChoice=new Set(["DRAFT","CHANGES_REQUESTED"]);
const linkable=new Set(["SENT","VIEWED","APPROVED","CONVERTED"]);
function readPreference(raw:unknown):DeliverySelection|null {
  const parsed=deliverySelectionSchema.safeParse(raw);
  return parsed.success?parsed.data:null;
}
async function ownerIdentity(tx:Prisma.TransactionClient,userId:string){
  const actor=await tx.user.findUnique({where:{id:userId},select:{role:true}});
  if(!actor||!["OWNER","ADMIN"].includes(actor.role))
    throw new Error("Only owner/administrators may prepare phone orders.");
}
/** All phone data is owner-entered context. Never called by public approval or
 * treated as a recorded signer, a card authorization or a scheduled visit. */
export async function recordPhoneOrderPreference(userId:string,estimateId:string,raw:unknown){
  const selected=deliverySelectionSchema.parse(raw);
  return prisma.$transaction(async tx=>{
    await ownerIdentity(tx,userId);
    await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id"=${estimateId} FOR UPDATE`;
    const estimate=await tx.estimate.findUnique({
      where:{id:estimateId},
      select:{id:true,status:true,phoneEnteredAt:true,deliveryOffer:true,
        deliveryOfferVersion:true,createdByUserId:true},
    });
    if(!estimate||!estimate.phoneEnteredAt||!allowedForChoice.has(estimate.status))
      throw new Error("This is not an editable phone-entered draft.");
    const reviewed=assertAvailableDeliveryOption(estimate.deliveryOffer,
      estimate.deliveryOfferVersion,selected);
    await tx.estimate.update({where:{id:estimateId},data:{
      phonePreferredDelivery:selected,phonePreferredAt:new Date(),
    }});
    await tx.auditLog.create({data:{userId,action:"phone_order.preference",
      entityType:"Estimate",entityId:estimateId,newValue:{
        offeredVersion:reviewed.offeredVersion,optionId:reviewed.slot.id,
        date:reviewed.slot.date,window:reviewed.slot.window,
        // Do not copy contact details, phone notes or cards into the audit.
        customerAcceptance:false,charged:false,booked:false,
      }}});
    return {slot:reviewed.slot,offeredVersion:reviewed.offeredVersion};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
/** Read-only for owner/admin. A lead email is useful before customer creation;
 * never include hidden data from unrelated client records. */
export async function getPhoneOrder(userId:string,estimateId:string):Promise<PhoneOrderView>{
  const actor=await prisma.user.findUnique({where:{id:userId},select:{role:true}});
  if(!actor||!["OWNER","ADMIN"].includes(actor.role))
    throw new Error("Owner/admin required.");
  const e=await prisma.estimate.findUnique({where:{id:estimateId},
    select:{id:true,title:true,status:true,createdByUserId:true,
      phoneEnteredByUserId:true,phoneEnteredAt:true,customerId:true,leadId:true,
      phonePreferredDelivery:true,deliveryOffer:true,
      deliveryOfferVersion:true,sentAt:true,
      lineItems:{select:{id:true}},customer:{select:{user:{select:{email:true}}}},
      lead:{select:{email:true}},
  }});
  if(!e?.phoneEnteredAt||!e.phoneEnteredByUserId)
    throw new Error("Phone order not found.");
  return {id:e.id,title:e.title,status:e.status,
    customerId:e.customerId,leadId:e.leadId,enteredAt:e.phoneEnteredAt,
    enteredByUserId:e.phoneEnteredByUserId,
    preferred:readPreference(e.phonePreferredDelivery),
    offerVersion:e.deliveryOfferVersion,
    slots:readOfferedSlots(e.deliveryOffer),sentAt:e.sentAt,
    recipient:e.customer?.user.email??e.lead?.email??null,
    itemCount:e.lineItems.length,
    selectedSource:readPreference(e.phonePreferredDelivery)?
      "OWNER_PHONE_INPUT":"NONE"};
}
export async function listPhoneOrders(userId:string,limit=40){
  const actor=await prisma.user.findUnique({where:{id:userId},select:{role:true}});
  if(!actor||!["OWNER","ADMIN"].includes(actor.role))
    throw new Error("Owner/admin required.");
  const count=z.number().int().min(1).max(100).parse(limit);
  return prisma.estimate.findMany({
    where:{phoneEnteredAt:{not:null}},
    orderBy:[{phoneEnteredAt:"desc"},{id:"desc"}],take:count,
    select:{id:true,title:true,status:true,phoneEnteredAt:true,
      createdByUserId:true,customer:{select:{user:{select:{name:true,email:true}}}},
      lead:{select:{contactName:true,email:true}}},
  });
}
/** This wraps the EXISTING W-24 send operation; it never emails through a
 * competing channel. Without a READY immutable quote the operator must
 * finish the real line items, tax review and driving route before sending.
 */
export async function sendPhoneOrderToFinish(userId:string,estimateId:string){
  const e=await getPhoneOrder(userId,estimateId);
  if(e.status!=="DRAFT"&&e.status!=="CHANGES_REQUESTED")
    throw new Error("Already sent or closed. Use the original customer link.");
  if(!e.recipient||!z.email().safeParse(e.recipient).success)
    throw new Error("Enter the customer's real email before sending.");
  if(!e.itemCount||!e.slots.length)
    throw new Error("Add all machines and offer at least one delivery date.");
  if(!e.preferred)
    throw new Error("Record the customer's preferred offered date and access details.");
  assertAvailableDeliveryOption(e.slots,e.offerVersion,e.preferred);
  const quote=await getPreparedEstimateQuote(estimateId);
  if(quote.status!=="READY"||quote.locations.length!==1||
      !quote.quoteFingerprint||!quote.orderFingerprint)
    throw new Error("Complete and review the single-site tax-inclusive W-24 order before sending.");
  // sendEstimate rechecks the whole snapshot under lock, claims a unique
  // sentAt, uses only approved customer-email delivery and dedupes repeats.
  const delivery=await sendEstimate(userId,estimateId,{requireReviewed:true});
  return {estimateId,delivery};
}
export async function getPhoneOrderShareEligibility(userId:string,estimateId:string){
  const e=await getPhoneOrder(userId,estimateId);
  return {canShare:linkable.has(e.status),status:e.status,
    canResend:false,recipient:e.recipient,
    preferred:e.preferred,enteredByUserId:e.enteredByUserId};
}

/** Public display helper — only a valid CURRENT owner-entered preference may
 * prefill the customer form. It is never auto-submitted or treated as consent. */
export function publicPhoneOrderPrefill(input:{
  phoneEnteredAt:Date|null;phonePreferredDelivery:unknown;
  deliveryOffer:unknown;deliveryOfferVersion:number;
}):DeliverySelection|null{
  if(!input.phoneEnteredAt) return null;
  const preferred=readPreference(input.phonePreferredDelivery);
  if(!preferred) return null;
  try{
    assertAvailableDeliveryOption(input.deliveryOffer,
      input.deliveryOfferVersion,preferred);
    return preferred;
  }catch{
    return null;
  }
}

/** Explicit OWNER/ADMIN pre-onboarding for an eligible NEW LEAD that the
 * operator has actually spoken to. Never substitute their final acceptance:
 * the created account has an unusable random password, no card and no signed
 * contract. Only the customer's later verified W-24 signing/payment can send
 * the one-time account activation link. */
export async function preparePhoneLeadCustomer(userId:string,estimateId:string){
  return prisma.$transaction(async tx=>{
    await ownerIdentity(tx,userId);
    await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id"=${estimateId} FOR UPDATE`;
    const e=await tx.estimate.findUnique({where:{id:estimateId},
      select:{id:true,phoneEnteredAt:true,status:true,leadId:true,customerId:true}});
    if(!e?.phoneEnteredAt||!allowedForChoice.has(e.status))
      throw new Error("Only an open phone-entered draft can be onboarded.");
    if(e.customerId)return {customerId:e.customerId,created:false};
    if(!e.leadId)throw new Error("This phone order has no lead to prepare.");
    const {convertLeadToCustomerInTx}=await import("@/domains/leads");
    const lead=await tx.lead.findUniqueOrThrow({
      where:{id:e.leadId},select:{status:true,convertedCustomerId:true}});
    let customerId=lead.convertedCustomerId;
    let newCustomer=false;
    if(!customerId){
      const converted=await convertLeadToCustomerInTx(tx,userId,e.leadId);
      customerId=converted.customer.id;
      newCustomer=converted.isNewAccount;
    }
    if(!customerId)throw new Error("Customer onboarding could not be verified.");
    await tx.estimate.update({where:{id:estimateId},data:{customerId}});
    await tx.auditLog.create({data:{
      userId,action:"phone_order.lead_prepared",
      entityType:"Estimate",entityId:estimateId,
      newValue:{customerId,newCustomer,accepted:false,paid:false,
        signatureRecorded:false,accountActivationSent:false},
    }});
    return {customerId,created:newCustomer};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
