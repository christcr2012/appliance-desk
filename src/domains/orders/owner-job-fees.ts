import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Owner-only approval for one evidenced job; never an implicit charge. */
export async function approveW24JobFee(actorId:string,jobId:string,
  kind:"MISSED_TRIP"|"RELOCATION",evidence:string,expectedVersion:number) {
  const reason=evidence.trim();
  if(reason.length<16||reason.length>500)throw new Error("Provide 16–500 characters of actual job evidence.");
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new Error("Job version is missing.");
  return prisma.$transaction(async tx=>{
    const actor=await tx.user.findUnique({where:{id:actorId},select:{role:true}});
    if(!actor||actor.role!=="OWNER")throw new Error("Owner-only fee approval.");
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id"=${jobId} FOR UPDATE`;
    const j=await tx.job.findUniqueOrThrow({where:{id:jobId},
      select:{type:true,status:true,version:true,agreementId:true,customerId:true,
        noShowAt:true,noShowCause:true,noShowEvidence:true,
        tripFeeApprovedAt:true,relocationFeeApprovedAt:true,
        approvedTripFeeCents:true,approvedRelocationFeeCents:true,customerPickupHandoff:true}});
    if(j.version!==expectedVersion)throw new Error("Job changed; refresh before approving a fee.");
    if(j.type==="SWAP"||j.type==="MAINTENANCE_VISIT")throw new Error("No setup or trip charge on service/swap visits.");
    // ZONE-1: the customer collects it at our place, so there is no trip to charge for.
    if(j.customerPickupHandoff)throw new Error("No trip or relocation charge on a customer pickup hand-over.");
    const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},
      select:{missedTripFeeCents:true,relocationFeeCents:true}});
    const amount=kind==="MISSED_TRIP"?settings?.missedTripFeeCents??0:settings?.relocationFeeCents??7500;
    if(!Number.isSafeInteger(amount)||amount<=0)
      throw new Error("This fee remains OFF at $0 or lacks configured owner terms.");
    if(kind==="MISSED_TRIP"&&(j.type!=="DELIVERY"||j.status!=="CANCELLED"||
       !j.noShowAt||!j.noShowCause||!j.noShowEvidence))
      throw new Error("A documented missed delivery is required for a trip fee.");
    if(kind==="RELOCATION"&&(j.type!=="DELIVERY"||!j.agreementId))
      throw new Error("Relocation requires a real delivery job and agreement.");
    if(kind==="MISSED_TRIP"&&(j.tripFeeApprovedAt||j.approvedTripFeeCents))
      throw new Error("A missed trip fee was already approved for this job.");
    if(kind==="RELOCATION"&&(j.relocationFeeApprovedAt||j.approvedRelocationFeeCents))
      throw new Error("One relocation fee per job; duplicate approval denied.");
    await tx.job.update({where:{id:jobId},data:{
      version:{increment:1},
      ...(kind==="MISSED_TRIP"?{
        approvedTripFeeCents:amount,approvedTripFeeReason:reason,
        tripFeeApprovedAt:new Date(),tripFeeApprovedByUserId:actorId,
      }:{
        approvedRelocationFeeCents:amount,relocationFeeEvidence:reason,
        relocationFeeApprovedAt:new Date(),relocationFeeApprovedByUserId:actorId,
      }),
    }});
    await tx.auditLog.create({data:{userId:actorId,
      action:kind==="MISSED_TRIP"?"w24.trip_fee_owner_approved":"w24.relocation_fee_owner_approved",
      entityType:"Job",entityId:jobId,
      newValue:{amountCents:amount,reason,automaticCharge:false,
        nextInvoiceSubjectToSeparateProviderAndTaxGates:true}}});
    await tx.staffTask.upsert({where:{sourceKey:"w24-review-next-bill:"+kind+":"+jobId},
      create:{sourceKey:"w24-review-next-bill:"+kind+":"+jobId,
        customerId:j.customerId,jobId,createdByUserId:actorId,priority:"HIGH",
        note:"Owner approved "+kind+" fee $"+(amount/100).toFixed(2)+
          " for this job. Review tax/legal basis and queue exactly one charge on NEXT invoice. No charge has been created yet."},
      update:{}});
    return{amountCents:amount,charged:false,version:expectedVersion+1};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
