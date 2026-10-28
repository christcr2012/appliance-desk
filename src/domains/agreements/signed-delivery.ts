import type { Prisma } from "@prisma/client";

/**
 * A signature creates a real unscheduled delivery visit, never a dispatched job. ZONE-1: for "I'll pick it up" it
 * creates the customer pickup hand-over job instead (a DELIVERY job marked customerPickupHandoff — see
 * domains/delivery/pickup-handoff.ts), so the hand-over is recorded through the same completion that starts the rental.
 */
export async function ensureSignedDeliveryDraftInTx(
 tx: Prisma.TransactionClient,
 agreement: {id:string;customerId:string;serviceAddressId:string|null;renewedFromAgreementId:string|null},
) {
 if (agreement.renewedFromAgreementId) return null;
 const { isAgreementPickupInTx } = await import("@/domains/delivery/pickup-guard");
 const pickup = await isAgreementPickupInTx(tx, agreement.id);
 const existing = await tx.job.findFirst({
  where:{agreementId:agreement.id,type:"DELIVERY",status:{not:"CANCELLED"},customerPickupHandoff:pickup},
  orderBy:[{createdAt:"asc"},{id:"asc"}],select:{id:true},
 });
 if(existing) return existing.id;
 const { PICKUP_HANDOFF_NOTE } = await import("@/domains/delivery/pickup-handoff");
 const created=await tx.job.create({data:{
  type:"DELIVERY",status:"SCHEDULED",scheduledAt:null,
  agreementId:agreement.id,customerId:agreement.customerId,
  serviceAddressId:agreement.serviceAddressId,
  customerPickupHandoff:pickup,
  notes:pickup ? PICKUP_HANDOFF_NOTE : "Agreement signed. Owner: review the signing payment and schedule delivery.",
 }});
 return created.id;
}
