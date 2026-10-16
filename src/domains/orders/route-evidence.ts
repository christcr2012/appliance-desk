import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { reviewedDrivingFee,drivingEvidenceSchema } from "./delivery";
import { getFrozenSigningOrderInTx } from "@/domains/billing/signing-frozen-verify";

async function ensureOwner(tx: Prisma.TransactionClient,userId:string) {
  const actor=await tx.user.findUnique({where:{id:userId},select:{role:true}});
  if(!actor||actor.role!=="OWNER")throw new Error("Owner approval required.");
}
export async function setVerifiedDrivingOrigin(userId:string,address:string,source:string) {
  const street=z.string().trim().min(15).max(300).parse(address);
  const reference=z.string().trim().min(12).max(500).parse(source);
  if(!/greeley/i.test(street)||!/[0-9]/.test(street))
    throw new Error("Record a verified street-level central Greeley origin, not a ZIP or city center.");
  return prisma.$transaction(async tx=>{
    await ensureOwner(tx,userId);
    await tx.businessSettings.upsert({where:{id:"singleton"},
      create:{drivingOriginAddress:street,drivingOriginVerifiedAt:new Date(),
        drivingOriginSourceReference:reference},
      update:{drivingOriginAddress:street,drivingOriginVerifiedAt:new Date(),
        drivingOriginSourceReference:reference}});
    await tx.auditLog.create({data:{userId,action:"delivery.route_origin_review",
      entityType:"BusinessSettings",entityId:"singleton",
      newValue:{origin:street,sourceReference:reference}}});
  });
}
/** No route API is bought or called. Operator records real road-route
 * evidence, not a ZIP centroid or a crow-flight distance. */
export async function recordDeliveryRouteEvidence(userId:string,
  target:{estimateId:string}|{agreementId:string},raw:unknown) {
  const evidence=drivingEvidenceSchema.parse(raw);
  return prisma.$transaction(async tx=>{
    await ensureOwner(tx,userId);
    const setting=await tx.businessSettings.findUnique({where:{id:"singleton"},
      select:{drivingOriginAddress:true,drivingOriginVerifiedAt:true}});
    if(!setting?.drivingOriginVerifiedAt)
      throw new Error("Owner must verify central Greeley origin first.");
    const fee=reviewedDrivingFee(evidence,setting.drivingOriginAddress);
    if("estimateId" in target){
      const e=await tx.estimate.findUnique({where:{id:target.estimateId},select:{status:true}});
      if(!e||!["DRAFT","CHANGES_REQUESTED","SENT","VIEWED"].includes(e.status))
        throw new Error("An accepted estimate cannot change road fees.");
      await tx.estimate.update({where:{id:target.estimateId},
        data:{deliveryRouteProof:evidence}});
    }else{
      const a=await tx.rentalAgreement.findUnique({where:{id:target.agreementId},
        select:{status:true,signature:{select:{signedAt:true}}}});
      if(!a||!["DRAFT","AWAITING_SIGNATURE"].includes(a.status)||a.signature?.signedAt)
        throw new Error("A signed agreement cannot change road fee evidence.");
      await tx.rentalAgreement.update({where:{id:target.agreementId},
        data:{deliveryRouteProof:evidence}});
    }
    await tx.auditLog.create({data:{userId,action:"delivery.driving_route_review",
      entityType:"estimateId" in target?"Estimate":"RentalAgreement",
      entityId:"estimateId" in target?target.estimateId:target.agreementId,
      newValue:{miles:evidence.miles,source:evidence.source,
        reference:evidence.sourceReference,band:fee.band,feeCents:fee.amountCents}}});
    return fee;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function assertRouteMatchesFrozenFeeInTx(
  tx:Prisma.TransactionClient,agreementId:string,raw:unknown) {
  const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},
    select:{drivingOriginAddress:true,drivingOriginVerifiedAt:true}});
  if(!settings?.drivingOriginVerifiedAt)
    throw new Error("Verified driving origin is required for offered delivery.");
  const band=reviewedDrivingFee(raw,settings.drivingOriginAddress);
  const frozen=await getFrozenSigningOrderInTx(tx,agreementId);
  const target=frozen.find(x=>x.agreementId===agreementId);
  if(!target||target.schemaVersion!==2)
    throw new Error("A reviewed V2 all-in order is required before booking delivery.");
  const lines=target.v2Extension.components.filter(x=>x.category==="DELIVERY");
  if(lines.length!==1)throw new Error("Frozen delivery fee component is missing.");
  const shown=lines[0].disposition==="DUE_NOW"?lines[0].amountCents:0;
  if(shown!==band.amountCents)
    throw new Error("Frozen signed delivery fee disagrees with verified driving band. Owner must review all-in price.");
  return band;
}
