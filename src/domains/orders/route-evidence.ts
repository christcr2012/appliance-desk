import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { reviewedDrivingFee,drivingEvidenceSchema,frozenRouteZones } from "./delivery";
import { getFrozenSigningOrderInTx } from "@/domains/billing/signing-frozen-verify";
import { readZoneSettings } from "@/domains/delivery/zone";
import { expectedZoneDeliveryCents, UNRESOLVED_ZONE_MESSAGE, type ZoneSnapshotLocation } from "@/domains/delivery/snapshot";

// ZONE-1: the road-mile bands come from the owner's delivery zones (same starting numbers as before).
const ZONE_FIELDS={deliveryZones:true,deliveryMaxMiles:true} as const;

async function ensureOwner(tx: Prisma.TransactionClient,userId:string) {
  // ZONE-1 audit: the standard row-locked re-check of an active owner (was a plain role read).
  try { await assertActiveTeamActor(tx,userId,["OWNER"]); }
  catch { throw new Error("Owner approval required."); }
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
  const parsed=drivingEvidenceSchema.parse(raw);
  return prisma.$transaction(async tx=>{
    await ensureOwner(tx,userId);
    const setting=await tx.businessSettings.findUnique({where:{id:"singleton"},
      select:{drivingOriginAddress:true,drivingOriginVerifiedAt:true,...ZONE_FIELDS}});
    if(!setting?.drivingOriginVerifiedAt)
      throw new Error("Owner must verify central Greeley origin first.");
    // The bands come from the current zones (never from the caller) and are frozen with the proof.
    const evidence={...parsed,zones:frozenRouteZones(readZoneSettings(setting))};
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
  // Uses the bands frozen with the proof, so a later zone change never blocks an offer already made.
  const band=reviewedDrivingFee(raw,settings.drivingOriginAddress);
  if(await frozenDeliveryShownInTx(tx,agreementId)!==band.amountCents)
    throw new Error("Frozen signed delivery fee disagrees with verified driving band. Owner must review all-in price.");
  return band;
}

/** The DELIVERY fee due now in the agreement's frozen V2 order. */
async function frozenDeliveryShownInTx(tx:Prisma.TransactionClient,agreementId:string):Promise<number>{
  const frozen=await getFrozenSigningOrderInTx(tx,agreementId);
  const target=frozen.find(x=>x.agreementId===agreementId);
  if(!target||target.schemaVersion!==2)
    throw new Error("A reviewed V2 all-in order is required before booking delivery.");
  const lines=target.v2Extension.components.filter(x=>x.category==="DELIVERY");
  if(lines.length!==1)throw new Error("Frozen delivery fee component is missing.");
  return lines[0].disposition==="DUE_NOW"?lines[0].amountCents:0;
}

/**
 * ZONE-1: the approval/signing guard for an offered delivery. Normal delivery is priced by the address's frozen zone
 * (straight line, Chris 2026-10-25): the frozen order's delivery fee must equal that zone price (0 for pickup). Only
 * when the owner recorded a driving-route exception is the fee checked against that proof's own frozen bands.
 * Zone settings changed later never change either answer.
 */
export function expectedDeliveryFeeCents(input:{zone:ZoneSnapshotLocation|null|undefined;
  routeProof:unknown;origin:string|null}):number{
  if(input.routeProof){
    if(!input.origin) throw new Error("Verified driving origin is required for offered delivery.");
    return reviewedDrivingFee(input.routeProof,input.origin).amountCents ?? 0;
  }
  const cents=expectedZoneDeliveryCents(input.zone);
  if(cents===null) throw new Error(UNRESOLVED_ZONE_MESSAGE);
  return cents;
}
export async function assertDeliveryFeeMatchesFrozenOrderInTx(tx:Prisma.TransactionClient,
  agreementId:string,input:{zone:ZoneSnapshotLocation|null|undefined;routeProof:unknown}){
  let origin:string|null=null;
  if(input.routeProof){
    const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},
      select:{drivingOriginAddress:true,drivingOriginVerifiedAt:true}});
    origin=settings?.drivingOriginVerifiedAt?settings.drivingOriginAddress:null;
  }
  const expected=expectedDeliveryFeeCents({zone:input.zone,routeProof:input.routeProof,origin});
  if(await frozenDeliveryShownInTx(tx,agreementId)!==expected)
    throw new Error("The frozen delivery fee doesn't match this address's delivery zone. Owner must review the all-in price.");
  return expected;
}
