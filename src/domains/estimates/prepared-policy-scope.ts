import { Prisma } from "@prisma/client";

/**
 * Shared lock/scope boundary for W-22FIN owner-only *draft* fee policies.
 * The caller must first authorize OWNER; no public controller calls this.
 * Does not read or mutate a provider, ledger, signature or delivery.
 */
export async function lockPreparedEstimatePolicyScopeInTx(
  tx:Prisma.TransactionClient,
  estimateId:string,expectedUpdatedAt:Date,
){
  if(!estimateId||!(expectedUpdatedAt instanceof Date)||
     !Number.isFinite(expectedUpdatedAt.getTime()))
    throw new Error("A current reviewed estimate is required.");
  await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id" = ${estimateId} FOR UPDATE`;
  const estimate=await tx.estimate.findUnique({
    where:{id:estimateId},select:{
      id:true,status:true,customerId:true,depositCents:true,
      depositPaidAt:true,updatedAt:true,
      customer:{select:{isBusiness:true,isPropertyManager:true}},
      lineItems:{select:{serviceAddressId:true,quantity:true,oneTimeFeeCents:true,
        package:{select:{components:{select:{quantity:true}}}}}},
    },
  });
  if(!estimate?.customerId||!estimate.customer||
     !["DRAFT","CHANGES_REQUESTED"].includes(estimate.status)||
     estimate.depositPaidAt||estimate.updatedAt.getTime()!==expectedUpdatedAt.getTime())
    throw new Error("Estimate terms changed or funds already exist; refresh the owner review.");
  const all=await tx.rentalAgreement.findMany({
    where:{sourceEstimateId:estimateId,customerId:estimate.customerId},
    select:{
      id:true,customerId:true,sourceEstimateId:true,serviceAddressId:true,
      status:true,depositCents:true,damageWaiverCents:true,
      commercialReservePolicyVersions:true,mandatoryChargeReviewVersions:true,
    },orderBy:{id:"asc"},
  });
  if(!all.length||all.length>500||
     new Set(all.map(row=>row.serviceAddressId)).size!==all.length||
     all.some(a=>a.status!=="DRAFT"))
    throw new Error("Prepared agreement set is missing, duplicated or no longer editable.");
  const expectedAddresses=new Set(estimate.lineItems.map(row=>row.serviceAddressId));
  if(expectedAddresses.has(null)||expectedAddresses.size!==all.length||
     all.some(a=>!expectedAddresses.has(a.serviceAddressId)))
    throw new Error("Prepared agreements disagree with the original service addresses.");
  const ids=all.map(row=>row.id).sort();
  await tx.$queryRaw`SELECT "id" FROM "RentalAgreement"
    WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  const locked=await tx.rentalAgreement.findMany({
    where:{id:{in:ids}},select:{
      id:true,customerId:true,sourceEstimateId:true,serviceAddressId:true,
      status:true,depositCents:true,damageWaiverCents:true,
      commercialReservePolicyVersions:true,mandatoryChargeReviewVersions:true,
    },orderBy:{id:"asc"},
  });
  if(locked.length!==all.length||locked.some((a,i)=>a.id!==all[i].id||
     a.status!=="DRAFT"||a.customerId!==estimate.customerId||
     a.sourceEstimateId!==estimate.id||a.serviceAddressId!==all[i].serviceAddressId))
    throw new Error("The prepared agreement set changed under owner review.");
  const [
    frozen,signatures,obligations,deposits,receipts,invoices,
    jobs,credits,
  ]=await Promise.all([
    tx.agreementSigningCharge.count({where:{agreementId:{in:ids},frozenAt:{not:null}}}),
    tx.signatureRecord.count({where:{agreementId:{in:ids}}}),
    tx.agreementSigningPayment.count({where:{agreementId:{in:ids}}}),
    tx.deposit.count({where:{agreementId:{in:ids}}}),
    tx.payment.count({where:{invoice:{agreementId:{in:ids}}}}),
    tx.invoice.count({where:{agreementId:{in:ids}}}),
    tx.job.count({where:{agreementId:{in:ids}}}),
    tx.signingDownPaymentCredit.count({where:{agreementId:{in:ids}}}),
  ]);
  if(frozen||signatures||obligations||deposits||receipts||invoices||jobs||credits)
    throw new Error("Signed, settled, invoice, delivery or provider money cannot be repriced.");
  return {estimate,agreements:locked,agreementIds:ids};
}
