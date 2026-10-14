import type { Prisma } from "@prisma/client";

/** A signature creates a real unscheduled delivery visit, never a dispatched job. */
export async function ensureSignedDeliveryDraftInTx(
 tx: Prisma.TransactionClient,
 agreement: {id:string;customerId:string;serviceAddressId:string|null;renewedFromAgreementId:string|null},
) {
 if (agreement.renewedFromAgreementId) return null;
 const existing = await tx.job.findFirst({
  where:{agreementId:agreement.id,type:"DELIVERY",status:{not:"CANCELLED"}},
  orderBy:[{createdAt:"asc"},{id:"asc"}],select:{id:true},
 });
 if(existing) return existing.id;
 const created=await tx.job.create({data:{
  type:"DELIVERY",status:"SCHEDULED",scheduledAt:null,
  agreementId:agreement.id,customerId:agreement.customerId,
  serviceAddressId:agreement.serviceAddressId,
  notes:"Agreement signed. Owner: review the signing payment and schedule delivery.",
 }});
 return created.id;
}
