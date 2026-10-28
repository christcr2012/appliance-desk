import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  effectiveMandatorySigningPolicy,
  type MandatoryChargeDecision,
} from "@/domains/billing/signing-mandatory-policy";
import {
  mandatoryChargeAmounts,nextMandatoryChargeReview,
  readMandatoryChargeHistory,validateLocalChargeChoice,
  type MandatoryLocationChoice,
} from "@/domains/billing/mandatory-charge-review";
import {
  allocateReviewedRdfForLocation,provisionalMandatoryServiceTaxInTx,
  provisionalRdfOrderDecisionInTx,
} from "@/domains/billing/mandatory-charge-assessment";
import { readCommercialReserveHistory } from "./commercial-reserve-policy";
import { lockPreparedEstimatePolicyScopeInTx } from "./prepared-policy-scope";
import { snapshotLocation } from "@/domains/delivery/snapshot";
import { expectedDeliveryChargeForAddressInTx } from "@/domains/orders/route-evidence";

export type PreparedMandatoryChargeLocation={
  agreementId:string;
  serviceAddressId:string;
  addressLabel:string;
  revision:number|null;
  decisions:MandatoryLocationChoice["decisions"];
  exceptionReasons:MandatoryLocationChoice["exceptionReasons"];
  retailDeliveryEvent:boolean;
  knownServiceFeesCents:number;
  taxCents:number|null;
  retailDeliveryCents:number|null;
  reserveCents:number;
  readiness:"REVIEW_REQUIRED"|"NOT_RECORDED";
  problems:string[];
};
export type PreparedMandatoryChargeOverview={
  estimateId:string;
  estimateUpdatedAt:string;
  globalPolicyRevision:number|null;
  settingsUpdatedAt:string|null;
  globalDecisions:MandatoryChargeDecision;
  locations:PreparedMandatoryChargeLocation[];
  canReview:boolean;
  problems:string[];
};
const summation=(values:number[])=>{
  if(values.some(x=>!Number.isSafeInteger(x)||x<0||x>100_000_000))
    throw new Error("One or more mandatory service fees are outside supported cents.");
  const sum=values.reduce((a,b)=>a+b,0);
  if(!Number.isSafeInteger(sum)||sum>100_000_000)
    throw new Error("Reviewed mandatory service fee total exceeds supported cents.");
  return sum;
};
/** Owner/admin diagnostics only; absence or staleness never means $0 payable. */
export async function getPreparedMandatoryChargeOverview(
  estimateId:string,
):Promise<PreparedMandatoryChargeOverview|null>{
  await requireRole("OWNER","ADMIN");
  return prisma.$transaction(async tx=>{
    const estimate=await tx.estimate.findUnique({
      where:{id:estimateId},select:{id:true,status:true,customerId:true,
        depositPaidAt:true,updatedAt:true},
    });
    if(!estimate?.customerId)return null;
    const [settings,agreements]=await Promise.all([
      tx.businessSettings.findUnique({where:{id:"singleton"},select:{
        signingMandatoryPolicyVersions:true,updatedAt:true,
      }}),
      tx.rentalAgreement.findMany({where:{
        sourceEstimateId:estimateId,customerId:estimate.customerId,
      },select:{
        id:true,serviceAddressId:true,status:true,depositCents:true,
        mandatoryChargeReviewVersions:true,
        serviceAddress:{select:{line1:true,city:true,state:true,zip:true}},
      },orderBy:{id:"asc"}}),
    ]);
    if(!agreements.length)return null;
    const global=effectiveMandatorySigningPolicy(settings?.signingMandatoryPolicyVersions,new Date());
    const problems:string[]=[];
    if(global.revision===null)problems.push("Set an effective owner mandatory-charge policy first.");
    if(!settings)problems.push("Owner business settings are unavailable.");
    const locations:PreparedMandatoryChargeLocation[]=agreements.map(a=>{
      const history=readMandatoryChargeHistory(a.mandatoryChargeReviewVersions);
      const latest=history.at(-1);
      const issues:string[]=[];
      if(a.status!=="DRAFT")issues.push("Only a draft can change fee decisions.");
      if(!latest)issues.push("The owner has not reviewed service fees for this address.");
      if(latest&&(latest.agreementId!==a.id||latest.estimateId!==estimateId||
         latest.serviceAddressId!==a.serviceAddressId))
        issues.push("Stored location fee policy identity does not match the estimate.");
      if(latest&&latest.reserveCents!==a.depositCents)
        issues.push("Negotiated refundable reserve changed since this fee review.");
      if(latest&&(latest.globalPolicyRevision!==global.revision||
         latest.settingsUpdatedAt!==settings?.updatedAt.toISOString()))
        issues.push("A new owner fee policy requires another location review.");
      if(latest?.tax.status!=="VERIFIED")
        issues.push("Location service tax classifications or jurisdictions need review.");
      if(latest?.retailDelivery.status==="UNDECIDED")
        issues.push("Colorado retail delivery fee or exemption still needs review.");
      problems.push(...issues.map(msg=>a.serviceAddress.line1+": "+msg));
      const charges=latest?.charges;
      return {
        agreementId:a.id,serviceAddressId:a.serviceAddressId,
        addressLabel:[a.serviceAddress.line1,a.serviceAddress.city,
          a.serviceAddress.state,a.serviceAddress.zip].join(", "),
        revision:latest?.revision??null,
        decisions:Object.fromEntries(["delivery","installation","removal","damageWaiver"]
          .map(kind=>[kind,charges?.find(x=>x.kind===kind)?.decision??
            (global.decision[kind as keyof typeof global.decision]==="REQUIRED"?
              "REQUIRED":"NOT_APPLICABLE")])) as PreparedMandatoryChargeLocation["decisions"],
        exceptionReasons:Object.fromEntries(charges?.filter(c=>c.reason)
          .map(c=>[c.kind,c.reason])??[]) as PreparedMandatoryChargeLocation["exceptionReasons"],
        retailDeliveryEvent:latest?.retailDelivery.event??false,
        knownServiceFeesCents:charges?
          summation(charges.map(row=>row.amountCents)):0,
        taxCents:latest?.tax.taxCents??null,
        retailDeliveryCents:latest?.retailDelivery.amountCents??null,
        reserveCents:a.depositCents,
        readiness:latest?"REVIEW_REQUIRED" as const:"NOT_RECORDED" as const,
        problems:issues,
      };
    });
    return {
      estimateId,estimateUpdatedAt:estimate.updatedAt.toISOString(),
      globalPolicyRevision:global.revision,
      settingsUpdatedAt:settings?.updatedAt.toISOString()??null,
      globalDecisions:global.decision,
      locations,canReview:["DRAFT","CHANGES_REQUESTED"].includes(estimate.status)&&
        !estimate.depositPaidAt,
      problems:[...new Set(problems)],
    };
  });
}
/**
 * Owners choose service applicability and justify local exceptions; actual
 * amounts and tax/Colorado RDF evidence come from the locked DB, not input.
 * This records a *provisional* policy scenario, not a payable all-in quote.
 */
export async function savePreparedMandatoryChargeReview(input:{
  actorUserId:string;estimateId:string;expectedEstimateUpdatedAt:Date;
  expectedGlobalPolicyRevision:number|null;expectedSettingsUpdatedAt:string|null;
  expectedRevisions:readonly {agreementId:string;revision:number|null}[];
  choices:readonly MandatoryLocationChoice[];reason:string;
}){
  if(!input.estimateId||!(input.expectedEstimateUpdatedAt instanceof Date)||
      !Number.isFinite(input.expectedEstimateUpdatedAt.getTime())||
      typeof input.reason!=="string"||input.reason.trim().length<12||
      input.reason.length>500)
    throw new Error("Refresh the reviewed estimate and give an owner reason.");
  if(!Array.isArray(input.choices)||!input.choices.length||input.choices.length>500)
    throw new Error("Review all prepared delivery locations together.");
  const ids=input.choices.map(row=>row.agreementId);
  if(new Set(ids).size!==ids.length||input.expectedRevisions.length!==ids.length||
      new Set(input.expectedRevisions.map(row=>row.agreementId)).size!==ids.length||
      input.expectedRevisions.some(row=>!ids.includes(row.agreementId)||
        (row.revision!==null&&(!Number.isSafeInteger(row.revision)||row.revision<1))))
    throw new Error("A duplicate, omitted, or stale location fee revision was supplied.");
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,input.actorUserId,["OWNER"]);
    const scope=await lockPreparedEstimatePolicyScopeInTx(
      tx,input.estimateId,input.expectedEstimateUpdatedAt);
    const {estimate,agreements,agreementIds}=scope;
    if(agreements.length!==input.choices.length||
       agreements.some(row=>!ids.includes(row.id)))
      throw new Error("Every original customer-owned delivery address must be reviewed.");
    // No in-progress business settings change may be mistaken for a
    // frozen owner-reviewed fee price.
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings"
      WHERE "id" = 'singleton' FOR SHARE`;
    const settings=await tx.businessSettings.findUniqueOrThrow({
      where:{id:"singleton"},select:{
        signingMandatoryPolicyVersions:true,updatedAt:true,
        oneTimeDeliveryFeeCents:true,oneTimeInstallationFeeCents:true,
        oneTimeRemovalFeeCents:true,damageWaiverEnabled:true,
      },
    });
    const asOf=new Date();
    const global=effectiveMandatorySigningPolicy(settings.signingMandatoryPolicyVersions,asOf);
    if(global.revision===null)
      throw new Error("Choose an effective global mandatory-charge policy first.");
    if(input.expectedGlobalPolicyRevision!==global.revision||
       input.expectedSettingsUpdatedAt!==settings.updatedAt.toISOString())
      throw new Error("Owner fee settings or effective policy changed. Refresh the review.");
    const byId=new Map(input.choices.map(row=>[
      row.agreementId,validateLocalChargeChoice(row,global.decision)]));
    if(global.decision.retailDelivery==="EXEMPT"&&
       input.choices.some(row=>row.retailDeliveryEvent))
      throw new Error("An exempt RDF policy cannot assign a chargeable delivery event.");
    // ZONE-1 (Codex finding on PR #604): an address the customer picks up has no delivery, so it can't carry the
    // retail delivery fee; an order picked up entirely has no delivery event at all.
    const zoneSource=await tx.estimate.findUnique({where:{id:estimate.id},select:{deliveryZoneSnapshot:true}});
    const pickupIds=new Set(agreements.filter(row=>snapshotLocation(zoneSource?.deliveryZoneSnapshot,
      row.serviceAddressId)?.choice==="CUSTOMER_PICKUP").map(row=>row.id));
    if(input.choices.some(row=>row.retailDeliveryEvent&&pickupIds.has(row.agreementId)))
      throw new Error("A customer pickup has no delivery, so it can't carry the retail delivery fee.");
    const deliveredCount=agreements.filter(row=>!pickupIds.has(row.id)).length;
    if(global.decision.retailDelivery==="REQUIRED"&&
       input.choices.filter(row=>row.retailDeliveryEvent).length!==(deliveredCount>0?1:0))
      throw new Error(deliveredCount>0?"Assign the potential RDF to exactly one original delivery event."
        :"Every address on this order is a customer pickup, so there is no delivery to carry the retail delivery fee.");
    if(input.choices.some(row=>row.retailDeliveryEvent&&!byId.has(row.agreementId)))
      throw new Error("An RDF event does not belong to this exact estimate.");
    const rdf=await provisionalRdfOrderDecisionInTx(tx,asOf);
    const versions=new Map(input.expectedRevisions.map(row=>[row.agreementId,row.revision]));
    const changed:string[]=[];
    const audit:Array<{
      agreementId:string;revision:number;feeCents:number;
      taxStatus:string;taxCents:number|null;rdfStatus:string;
      rdfCustomerCents:number|null;refundableReserveCents:number;
      sourceFingerprint:string;
    }>=[];
    for(const agreement of agreements){
      const choice=byId.get(agreement.id)!;
      // RDF cannot be moved onto an out-of-state location to mask its tax
      // event. Rate and applicability remain independently versioned.
      const address=await tx.serviceAddress.findUniqueOrThrow({
        where:{id:agreement.serviceAddressId},select:{state:true},
      });
      if(choice.retailDeliveryEvent&&address.state!=="CO")
        throw new Error("Only a Colorado delivery may carry a Colorado retail delivery fee.");
      const history=readMandatoryChargeHistory(agreement.mandatoryChargeReviewVersions);
      const prior=history.at(-1);
      if((prior?.revision??null)!==versions.get(agreement.id))
        throw new Error("An owner changed reviewed service fees. Refresh the full order.");
      // ZONE-1: the delivery price is the one helper's answer for this address (pickup $0, an owner-recorded
      // driving-route exception's frozen price, else the frozen zone price); older estimates keep the configured fee.
      const zoneDelivery=await expectedDeliveryChargeForAddressInTx(tx,{estimateId:estimate.id,agreementId:agreement.id,
        serviceAddressId:agreement.serviceAddressId,zone:snapshotLocation(zoneSource?.deliveryZoneSnapshot,agreement.serviceAddressId)});
      const charges=mandatoryChargeAmounts({
        global:global.decision,choice,
        settings:{
          delivery:zoneDelivery??settings.oneTimeDeliveryFeeCents,
          installation:settings.oneTimeInstallationFeeCents,
          removal:settings.oneTimeRemovalFeeCents,
          waiverEnabled:settings.damageWaiverEnabled,
        },
        agreementWaiverCents:agreement.damageWaiverCents,
      });
      const commercialHistory=readCommercialReserveHistory(
        agreement.commercialReservePolicyVersions);
      const reserveRevision=commercialHistory.at(-1)?.revision??null;
      const tax=await provisionalMandatoryServiceTaxInTx(tx,agreement.id,charges,asOf);
      const retailDelivery=allocateReviewedRdfForLocation(
        rdf,global.decision.retailDelivery,choice.retailDeliveryEvent,pickupIds.has(agreement.id));
      if(address.state!=="CO"&&retailDelivery.status==="APPLIES")
        throw new Error("RDF may only be allocated to Colorado service addresses.");
      if(commercialHistory.at(-1)&&
         commercialHistory.at(-1)!.amountCents!==agreement.depositCents)
        throw new Error("A commercial reserve amount disagrees with its owner terms.");
      const update=nextMandatoryChargeReview({
        previous:agreement.mandatoryChargeReviewVersions,
        revision:{
          estimateId:estimate.id,agreementId:agreement.id,
          serviceAddressId:agreement.serviceAddressId,
          actorUserId:input.actorUserId,recordedAt:asOf.toISOString(),
          reason:input.reason.trim(),globalPolicyRevision:global.revision,
          settingsUpdatedAt:settings.updatedAt.toISOString(),charges,tax,
          retailDelivery,reserveRevision,reserveCents:agreement.depositCents,
        },
      });
      if(!update.changed)continue;
      await tx.rentalAgreement.update({where:{id:agreement.id},data:{
        mandatoryChargeReviewVersions:update.versions,
      }});
      changed.push(agreement.id);
      audit.push({agreementId:agreement.id,revision:update.current.revision,
        feeCents:summation(charges.map(c=>c.amountCents)),
        taxStatus:tax.status,taxCents:tax.taxCents,
        rdfStatus:retailDelivery.status,
        rdfCustomerCents:retailDelivery.handling==="COLLECT_FROM_CUSTOMER"?
          retailDelivery.amountCents:0,
        refundableReserveCents:agreement.depositCents,
        sourceFingerprint:update.current.sourceFingerprint});
    }
    if(changed.length){
      await tx.agreementSigningCharge.deleteMany({
        where:{agreementId:{in:agreementIds},frozenAt:null}});
      await tx.estimate.update({where:{id:estimate.id},data:{
        reviewedQuoteFingerprint:null,reviewedOrderFingerprint:null,reviewedQuoteAt:null,
      }});
      await tx.auditLog.create({data:{
        userId:input.actorUserId,action:"estimate.mandatory_location_charge_review",
        entityType:"Estimate",entityId:estimate.id,
        newValue:{globalPolicyRevision:global.revision,changed,audit,
          reason:input.reason.trim(),
          status:"OWNER_REVIEW_ONLY",legalAndTaxAcceptance:"PENDING",
          note:"Tax, RDF and fees are provisional; no binding quote or money movement"},
      }});
    }
    return {estimateId:estimate.id,changedAgreementIds:changed,
      status:"REVIEW_REQUIRED" as const};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20_000});
}
