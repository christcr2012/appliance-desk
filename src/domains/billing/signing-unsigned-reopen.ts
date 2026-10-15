import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/** Audited unsigned-only invalidation; never revises a sent/signature/payment.
 * Owner must prepare, allocate/review, freeze and clear the new version again. */
export async function reopenUnsignedSigningOrder(actorUserId:string,input:{
  agreementId:string;expectedOrderFingerprint:string;reason:string;
}){
 const reason=input.reason.trim();
 if(reason.length<12||reason.length>500||!/^[a-f0-9]{64}$/.test(input.expectedOrderFingerprint))
   throw new Error("Review the exact order and enter a 12–500 character reason.");
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,actorUserId,["OWNER"]);
  const target=await tx.rentalAgreement.findUniqueOrThrow({where:{id:input.agreementId},select:{id:true,customerId:true,sourceEstimateId:true}});
  if(target.sourceEstimateId){
   await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id"=${target.sourceEstimateId} FOR UPDATE`;
   const estimate=await tx.estimate.findUniqueOrThrow({where:{id:target.sourceEstimateId},select:{status:true}});
   if(!["DRAFT","CHANGES_REQUESTED"].includes(estimate.status))
    throw new Error("Request a revised editable estimate before reopening an offered or accepted order.");
  }
  const scope=await tx.rentalAgreement.findMany({where:{customerId:target.customerId,...(target.sourceEstimateId?{sourceEstimateId:target.sourceEstimateId}:{id:target.id})},select:{id:true},orderBy:{id:"asc"}});
  const ids=scope.map(row=>row.id);
  if(!ids.length||ids.length>500||!ids.includes(target.id))throw new Error("The complete draft order is unavailable.");
  await tx.$queryRaw`SELECT "id" FROM "RentalAgreement" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  const agreements=await tx.rentalAgreement.findMany({where:{id:{in:ids}},select:{status:true,firstDeliveredOn:true,billingStartedAt:true}});
  const [signatures,payments,invoices,jobs,deposits]=await Promise.all([
   tx.signatureRecord.count({where:{agreementId:{in:ids}}}),tx.agreementSigningPayment.count({where:{agreementId:{in:ids}}}),
   tx.invoice.count({where:{agreementId:{in:ids}}}),tx.job.count({where:{agreementId:{in:ids}}}),tx.deposit.count({where:{agreementId:{in:ids}}}),
  ]);
  if(agreements.some(row=>row.status!=="DRAFT"||row.firstDeliveredOn||row.billingStartedAt)||signatures||payments||invoices||jobs||deposits)
   throw new Error("A sent signature, payment, invoice or delivery prevents unsigned reopening. Preserve the original financial evidence.");
  const charges=await tx.agreementSigningCharge.findMany({where:{agreementId:{in:ids}},orderBy:{agreementId:"asc"}});
  if(charges.length!==ids.length||charges.some(row=>!row.frozenAt||row.frozenOrderFingerprint!==input.expectedOrderFingerprint))
   throw new Error("Frozen order changed. Refresh the review before reopening.");
  // Audit the complete prior evidence before clearing the mutable unsigned
  // snapshot. New versions have new fingerprints; old clearance cannot carry.
  await tx.auditLog.create({data:{userId:actorUserId,action:"signing.unsigned_order_reopened",entityType:"RentalAgreement",entityId:target.id,
   oldValue:JSON.parse(JSON.stringify(charges)),newValue:{reason,previousOrderFingerprint:input.expectedOrderFingerprint,agreementIds:ids}}});
  await tx.agreementSigningCharge.updateMany({where:{agreementId:{in:ids}},data:{
   version:{increment:1},frozenAt:null,frozenOrderFingerprint:null,frozenAllInCents:null,frozenSetupTaxCents:null,frozenChargeEvidence:Prisma.DbNull,
  }});
  if(target.sourceEstimateId)await tx.estimate.update({where:{id:target.sourceEstimateId},data:{reviewedQuoteFingerprint:null,reviewedOrderFingerprint:null,reviewedQuoteAt:null}});
  return {agreements:ids.length};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20_000});
}
