import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { reviewedDrivingFee,drivingEvidenceSchema,frozenRouteZones,frozenRouteExceptionCents } from "./delivery";
import { getFrozenSigningOrderInTx } from "@/domains/billing/signing-frozen-verify";
import { readZoneSettings } from "@/domains/delivery/zone";
import { expectedZoneDeliveryCents, UNRESOLVED_ZONE_MESSAGE, type ZoneSnapshotLocation } from "@/domains/delivery/snapshot";

// ZONE-1: the road-mile bands come from the owner's delivery zones (same starting numbers as before).
const ZONE_FIELDS={deliveryZones:true,deliveryMaxMiles:true} as const;

export const MULTI_ADDRESS_ROUTE_MESSAGE=
  "This estimate has more than one address, so a driving-route exception must be recorded on that address's agreement.";

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
      // ZONE-1: an estimate-level exception must belong to exactly one address.
      const lines=await tx.estimateLineItem.findMany({where:{estimateId:target.estimateId},select:{serviceAddressId:true}});
      if(new Set(lines.map(line=>line.serviceAddressId).filter(Boolean)).size!==1)
        throw new Error(MULTI_ADDRESS_ROUTE_MESSAGE);
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

/**
 * ZONE-1 (Chris 2026-10-25): normal delivery is priced by straight line from the address's frozen zone; route evidence
 * is only for an owner-recorded exception. What one address's delivery charge must be:
 *  - "I'll pick it up" -> $0;
 *  - an owner-recorded driving-route exception for that address -> the price frozen with that proof;
 *  - otherwise the frozen zone price (refused while the zone is unknown or outside the area).
 * null: not zone-priced and no exception (older orders keep their configured fee).
 */
export function expectedDeliveryFeeCents(input:{zone:ZoneSnapshotLocation|null|undefined;routeProof:unknown}):number|null{
  if(input.zone?.choice==="CUSTOMER_PICKUP") return 0;
  if(input.routeProof) return frozenRouteExceptionCents(input.routeProof);
  if(!input.zone) return null;
  const cents=expectedZoneDeliveryCents(input.zone);
  if(cents===null) throw new Error(UNRESOLVED_ZONE_MESSAGE);
  return cents;
}

/** The owner-recorded driving-route exception for one address, if any: on its agreement(s), else on a one-address estimate. */
export async function routeExceptionForAddressInTx(tx:Prisma.TransactionClient,
  input:{estimateId:string|null;agreementId?:string|null;serviceAddressId:string}):Promise<unknown>{
  const owners=[...(input.agreementId?[{id:input.agreementId}]:[]),...(input.estimateId?[{sourceEstimateId:input.estimateId}]:[])];
  if(!owners.length) return null;
  const rows=await tx.rentalAgreement.findMany({where:{serviceAddressId:input.serviceAddressId,OR:owners},
    select:{deliveryRouteProof:true}});
  const proofs=[...new Set(rows.map(row=>row.deliveryRouteProof).filter(proof=>proof!==null&&proof!==undefined)
    .map(proof=>JSON.stringify(proof)))];
  if(proofs.length>1)
    throw new Error("This address has two different driving-route exceptions. The owner must review the delivery fee.");
  if(proofs.length) return JSON.parse(proofs[0]!) as unknown;
  if(!input.estimateId) return null;
  const estimate=await tx.estimate.findUnique({where:{id:input.estimateId},
    select:{deliveryRouteProof:true,lineItems:{select:{serviceAddressId:true}}}});
  if(!estimate?.deliveryRouteProof) return null;
  const addresses=[...new Set(estimate.lineItems.map(line=>line.serviceAddressId).filter(Boolean))];
  if(addresses.length!==1) throw new Error(MULTI_ADDRESS_ROUTE_MESSAGE);
  return addresses[0]===input.serviceAddressId?estimate.deliveryRouteProof:null;
}

/**
 * The one helper every delivery-amount check uses (quote preparation, the service-fee review, approval, signing):
 * the delivery charge this address must carry, in cents. See expectedDeliveryFeeCents for the order of precedence.
 */
export async function expectedDeliveryChargeForAddressInTx(tx:Prisma.TransactionClient,
  input:{estimateId:string|null;agreementId?:string|null;serviceAddressId:string;zone:ZoneSnapshotLocation|null|undefined}):Promise<number|null>{
  if(input.zone?.choice==="CUSTOMER_PICKUP") return 0;
  const routeProof=await routeExceptionForAddressInTx(tx,input);
  return expectedDeliveryFeeCents({zone:input.zone,routeProof});
}

/** Offered delivery windows need the exact reviewed V2 all-in order (its amount is checked with the helper above). */
export async function assertFrozenV2DeliveryOrderInTx(tx:Prisma.TransactionClient,agreementId:string):Promise<void>{
  const frozen=await getFrozenSigningOrderInTx(tx,agreementId);
  const target=frozen.find(x=>x.agreementId===agreementId);
  if(!target||target.schemaVersion!==2)
    throw new Error("A reviewed V2 all-in order is required before booking delivery.");
  if(target.v2Extension.components.filter(x=>x.category==="DELIVERY").length!==1)
    throw new Error("Frozen delivery fee component is missing.");
}

export type CustomerDeliveryCharge = {
  /** What delivery costs this address if the customer chooses it (cents); null = to be confirmed. */
  deliverCents: number | null;
  /** True when an owner-recorded driving-route exception sets that price instead of the zone price. */
  routeException: boolean;
};

/**
 * ZONE-1 (Codex finding on PR #604): the customer's estimate page shows the SAME delivery charge that quote preparation,
 * approval and signing require, so a route exception never shows "free" above a quote that charges for delivery.
 * Read-only; a problem the owner must sort out (e.g. two different exceptions) shows "price to be confirmed".
 */
export async function customerDeliveryChargesForEstimate(estimateId: string,
  locations: ZoneSnapshotLocation[]): Promise<Record<string, CustomerDeliveryCharge>> {
  const out: Record<string, CustomerDeliveryCharge> = {};
  await prisma.$transaction(async (tx) => {
    for (const location of locations) {
      try {
        const routeProof = await routeExceptionForAddressInTx(tx, { estimateId, serviceAddressId: location.serviceAddressId });
        const deliverCents = expectedDeliveryFeeCents({ zone: { ...location, choice: "DELIVER" }, routeProof });
        out[location.serviceAddressId] = { deliverCents, routeException: Boolean(routeProof) };
      } catch {
        out[location.serviceAddressId] = { deliverCents: null, routeException: false };
      }
    }
  });
  return out;
}
