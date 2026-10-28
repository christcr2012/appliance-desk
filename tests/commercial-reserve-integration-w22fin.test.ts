import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { prepareEstimateAgreementsBeforeApproval } from
  "@/domains/estimates/preapproval-agreements";
import { getPreparedReserveOverview,savePreparedCommercialReserveAllocation } from
  "@/domains/estimates/commercial-reserve-allocation";
import { getPreparedMandatoryChargeOverview,savePreparedMandatoryChargeReview } from
  "@/domains/estimates/mandatory-charge-allocation";
import { recordMandatorySigningPolicy } from
  "@/domains/billing/signing-mandatory-policy";

vi.mock("@/lib/session",()=>({
  requireRole:async()=>({user:{id:"synthetic-owner-session",role:"OWNER"}}),
}));
const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&url.pathname==="/appliance_desk_test"&&
  ["localhost","127.0.0.1"].includes(url.hostname);
describe.skipIf(!enabled)("W-22FIN commercial reserve owner workflow on disposable PostgreSQL",()=>{
  const key=randomUUID().replaceAll("-","");
  let owner="",staff="",customerUser="",customerId="",estimateId="",
    addressA="",addressB="",packageId="",applianceTypeId="";
  let ids:string[]=[];
  const termsA="Commercial property A negotiated refundable reserve; counsel confirmation pending";
  const termsB="Commercial property B negotiated refundable reserve; counsel confirmation pending";
  beforeAll(async()=>{
    const [a,b,c]=await Promise.all([
      prisma.user.create({data:{email:`reserve-owner-${key}@example.test`,role:"OWNER",
        passwordHash:"test-only"}}),
      prisma.user.create({data:{email:`reserve-staff-${key}@example.test`,role:"STAFF",
        passwordHash:"test-only"}}),
      prisma.user.create({data:{email:`reserve-customer-${key}@example.test`,
        role:"CUSTOMER",passwordHash:"test-only"}}),
    ]);
    owner=a.id;staff=b.id;customerUser=c.id;
    const customer=await prisma.customer.create({data:{userId:c.id,
      isBusiness:true,referralCode:("RV"+key).slice(0,20).toUpperCase()}});
    customerId=customer.id;
    const addresses=await Promise.all([
      prisma.serviceAddress.create({data:{customerId,line1:"101 Example Road",
        city:"Greeley",state:"CO",zip:"80631"}}),
      prisma.serviceAddress.create({data:{customerId,line1:"202 Example Road",
        city:"Greeley",state:"CO",zip:"80631"}}),
    ]);
    addressA=addresses[0].id;addressB=addresses[1].id;
    const appliance=await prisma.applianceType.create({data:{
      name:"Reserve Synthetic "+key,slug:"reserve-"+key,monthlyPriceCents:3500}});
    applianceTypeId=appliance.id;
    const pkg=await prisma.rentalPackage.create({data:{
      name:"Reserve Set "+key,slug:"reserve-set-"+key,monthlyPriceCents:6000,
      components:{create:[{applianceTypeId,quantity:2}]},
    }});
    packageId=pkg.id;
    const estimate=await prisma.estimate.create({data:{
      customerId,createdByUserId:owner,title:"Commercial two-location reserve",
      status:"DRAFT",depositCents:15000,
      lineItems:{create:[
        {serviceAddressId:addressA,packageId,description:"Property A washer set",
          quantity:1,monthlyPriceCents:6000},
        {serviceAddressId:addressB,packageId,description:"Property B washer set",
          quantity:1,monthlyPriceCents:6000},
      ]},
    }});
    estimateId=estimate.id;
    ids=await prepareEstimateAgreementsBeforeApproval(owner,estimateId,{mode:"per-property"});
  });
  afterAll(async()=>{
    await prisma.rentalAgreement.deleteMany({where:{sourceEstimateId:estimateId}});
    await prisma.estimate.deleteMany({where:{id:estimateId}});
    await prisma.rentalPackageComponent.deleteMany({where:{packageId}});
    await prisma.rentalPackage.deleteMany({where:{id:packageId}});
    await prisma.applianceType.deleteMany({where:{id:applianceTypeId}});
    await prisma.serviceAddress.deleteMany({where:{id:{in:[addressA,addressB]}}});
    await prisma.customer.deleteMany({where:{id:customerId}});
    await prisma.auditLog.deleteMany({where:{userId:{in:[owner,staff]}}});
    await prisma.user.deleteMany({where:{id:{in:[owner,staff,customerUser]}}});
  });
  async function snapshot(){
    const overview=await getPreparedReserveOverview(estimateId);
    if(!overview)throw Error("Expected prepared overview");
    const allocations=overview.allocations.map((row)=>({
      agreementId:row.agreementId,
      amountCents:row.serviceAddressId===addressA?10000:5000,
      replenishment:"QUARTERLY" as const,
      termsReference:row.serviceAddressId===addressA?termsA:termsB,
    }));
    return {overview,allocations,
      expectedRevisions:overview.allocations.map(row=>({
        agreementId:row.agreementId,revision:row.revision,
      }))};
  }
  it("never copies the entire estimate deposit into both new agreements",async()=>{
    const rows=await prisma.rentalAgreement.findMany({where:{sourceEstimateId:estimateId}});
    expect(rows).toHaveLength(2);
    expect(rows.every(row=>row.depositCents===0)).toBe(true);
    expect(await prisma.deposit.count({where:{agreementId:{in:ids}}})).toBe(0);
    const overview=await getPreparedReserveOverview(estimateId);
    expect(overview).toMatchObject({expectedReserveCents:15000,allocatedReserveCents:0,
      businessEligible:true,canAllocate:true});
    expect(overview?.reasons.join(" ")).toMatch(/allocate/i);
  });
  it("denies staff, forged cross-location IDs and sums before any data is written",async()=>{
    const draft=await snapshot();
    const input={actorUserId:staff,estimateId,
      expectedEstimateUpdatedAt:new Date(draft.overview.estimateUpdatedAt),
      expectedRevisions:draft.expectedRevisions,allocations:draft.allocations,
      reason:"The owner negotiated commercial security amounts per location"};
    await expect(savePreparedCommercialReserveAllocation(input)).rejects.toThrow();
    await expect(savePreparedCommercialReserveAllocation({...input,actorUserId:owner,
      allocations:input.allocations.map(row=>({...row,amountCents:10000}))}))
      .rejects.toThrow(/must equal/i);
    await expect(savePreparedCommercialReserveAllocation({...input,actorUserId:owner,
      allocations:[input.allocations[0],{...input.allocations[1],agreementId:"foreign"}]}))
      .rejects.toThrow();
    expect((await prisma.rentalAgreement.findMany({
      where:{sourceEstimateId:estimateId}})).every(row=>row.depositCents===0)).toBe(true);
  });
  it("atomically allocates 10000+5000 with original location history and no collection",async()=>{
    const draft=await snapshot();
    const input={actorUserId:owner,estimateId,
      expectedEstimateUpdatedAt:new Date(draft.overview.estimateUpdatedAt),
      expectedRevisions:draft.expectedRevisions,allocations:draft.allocations,
      reason:"Owner negotiated distinct refundable reserves at the two addresses"};
    const result=await savePreparedCommercialReserveAllocation(input);
    expect(result).toMatchObject({allocatedCents:15000,status:"REVIEW_REQUIRED"});
    expect(result.changedAgreementIds).toHaveLength(2);
    const after=await getPreparedReserveOverview(estimateId);
    expect(after).toMatchObject({expectedReserveCents:15000,allocatedReserveCents:15000});
    expect(after?.allocations.map(row=>row.amountCents).sort((a,b)=>a-b)).toEqual([5000,10000]);
    expect(after?.allocations.every(row=>row.revision===1)).toBe(true);
    expect(await prisma.deposit.count({where:{agreementId:{in:ids}}})).toBe(0);
    expect(await prisma.agreementSigningPayment.count({where:{agreementId:{in:ids}}})).toBe(0);
    expect(await prisma.invoice.count({where:{agreementId:{in:ids}}})).toBe(0);
    expect(await prisma.auditLog.count({where:{
      entityId:estimateId,action:"estimate.commercial_reserve_allocation"}})).toBe(1);
    const repeated=await snapshot();
    const replay=await savePreparedCommercialReserveAllocation({...input,
      expectedEstimateUpdatedAt:new Date(repeated.overview.estimateUpdatedAt),
      expectedRevisions:repeated.expectedRevisions});
    expect(replay.changedAgreementIds).toHaveLength(0);
    expect(await prisma.auditLog.count({where:{
      entityId:estimateId,action:"estimate.commercial_reserve_allocation"}})).toBe(1);
  });
  it("rejects stale reviewed revision and SQL rewrite of prior term histories",async()=>{
    const snap=await snapshot();
    await expect(savePreparedCommercialReserveAllocation({
      actorUserId:owner,estimateId,
      expectedEstimateUpdatedAt:new Date("2026-01-01T00:00:00.000Z"),
      expectedRevisions:snap.expectedRevisions,allocations:snap.allocations,
      reason:"An owner tried to save a previous estimate draft"}))
      .rejects.toThrow(/terms changed/);
    const target=await prisma.rentalAgreement.findUniqueOrThrow({where:{id:ids[0]}});
    await expect(prisma.rentalAgreement.update({where:{id:target.id},data:{
      commercialReservePolicyVersions:[],
    }})).rejects.toThrow();
    const current=await prisma.rentalAgreement.findUniqueOrThrow({where:{id:target.id}});
    expect(current.commercialReservePolicyVersions).toEqual(target.commercialReservePolicyVersions);
  });
  it("records OWNER-only per-address mandatory fee decisions with versioned tax/RDF review and no money",async()=>{
    // Exact singleton policy is restored after the disposable fixture; every
    // test uses customer-owned preapproval drafts, never production money.
    const prior=(await prisma.businessSettings.findUniqueOrThrow({
      where:{id:"singleton"},
    })).signingMandatoryPolicyVersions;
    try{
      await recordMandatorySigningPolicy(owner,{
        effectiveFromKey:"2026-10-14",
        reason:"Synthetic internal test for all-location fee applicability",
        decisions:{
          delivery:"NOT_APPLICABLE",installation:"NOT_APPLICABLE",
          removal:"NOT_APPLICABLE",damageWaiver:"NOT_APPLICABLE",
          retailDelivery:"EXEMPT",
        },
      });
      const review=await getPreparedMandatoryChargeOverview(estimateId);
      expect(review?.locations).toHaveLength(2);
      expect(review?.globalPolicyRevision).not.toBeNull();
      const choices=review!.locations.map(location=>({
        agreementId:location.agreementId,
        decisions:{
          delivery:"NOT_APPLICABLE" as const,
          installation:"NOT_APPLICABLE" as const,
          removal:"NOT_APPLICABLE" as const,
          damageWaiver:"NOT_APPLICABLE" as const,
        },
        exceptionReasons:{},retailDeliveryEvent:false,
      }));
      const input={
        actorUserId:staff,estimateId,
        expectedEstimateUpdatedAt:new Date(review!.estimateUpdatedAt),
        expectedGlobalPolicyRevision:review!.globalPolicyRevision,
        expectedSettingsUpdatedAt:review!.settingsUpdatedAt,
        expectedRevisions:review!.locations.map(l=>({
          agreementId:l.agreementId,revision:l.revision,
        })),
        choices,reason:"Owner reviewed all local service fees as not applicable for the synthetic delivery",
      };
      await expect(savePreparedMandatoryChargeReview(input)).rejects.toThrow();
      expect((await prisma.rentalAgreement.findMany({
        where:{sourceEstimateId:estimateId},
      })).every(a=>Array.isArray(a.mandatoryChargeReviewVersions)&&
        a.mandatoryChargeReviewVersions.length===0)).toBe(true);
      const result=await savePreparedMandatoryChargeReview({...input,actorUserId:owner});
      expect(result.changedAgreementIds).toHaveLength(2);
      const saved=await prisma.rentalAgreement.findMany({
        where:{sourceEstimateId:estimateId},
      });
      for(const agreement of saved){
        expect(agreement.mandatoryChargeReviewVersions).toHaveLength(1);
        const row=(agreement.mandatoryChargeReviewVersions as Array<Record<string,unknown>>)[0];
        expect(row).toMatchObject({schemaVersion:1,revision:1,
          agreementId:agreement.id,estimateId,professionalReview:"REVIEW_REQUIRED"});
        expect(row.tax).toMatchObject({status:"REVIEW_REQUIRED"});
        expect(row.retailDelivery).toMatchObject({event:false});
        expect(row.charges).toMatchObject([
          {kind:"delivery",amountCents:0},{kind:"installation",amountCents:0},
          {kind:"removal",amountCents:0},{kind:"damageWaiver",amountCents:0},
        ]);
        await expect(prisma.rentalAgreement.update({where:{id:agreement.id},
          data:{mandatoryChargeReviewVersions:[]}})).rejects.toThrow();
      }
      expect(await prisma.auditLog.count({where:{
        entityId:estimateId,action:"estimate.mandatory_location_charge_review",
      }})).toBe(1);
      expect(await prisma.deposit.count({where:{agreementId:{in:ids}}})).toBe(0);
      await expect(savePreparedMandatoryChargeReview({...input,actorUserId:owner}))
        .rejects.toThrow(/review/i);
    }finally{
      await prisma.businessSettings.update({where:{id:"singleton"},data:{
        signingMandatoryPolicyVersions:prior as never,
      }});
    }
  });
  it("ZONE-1: a customer pickup carries no retail delivery fee, and an all-pickup order needs no fee event (Codex finding on PR #604)",async()=>{
    const prior=(await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}})).signingMandatoryPolicyVersions;
    const priorZone=(await prisma.estimate.findUniqueOrThrow({where:{id:estimateId}})).deliveryZoneSnapshot;
    const location=(serviceAddressId:string,choice:"DELIVER"|"CUSTOMER_PICKUP")=>({serviceAddressId,zone:1,name:"Local",
      miles:4,method:"STRAIGHT_LINE",center:{lat:40.4233,lon:-104.7091},priceCents:0,pickupPriceCents:0,choice,
      checkedAt:new Date().toISOString()});
    const setChoices=(a:"DELIVER"|"CUSTOMER_PICKUP",b:"DELIVER"|"CUSTOMER_PICKUP")=>prisma.estimate.update({
      where:{id:estimateId},data:{deliveryZoneSnapshot:{version:1,locations:[location(addressA,a),location(addressB,b)]} as never}});
    const save=async(event:(agreementId:string)=>boolean)=>{
      const review=(await getPreparedMandatoryChargeOverview(estimateId))!;
      return savePreparedMandatoryChargeReview({
        actorUserId:owner,estimateId,expectedEstimateUpdatedAt:new Date(review.estimateUpdatedAt),
        expectedGlobalPolicyRevision:review.globalPolicyRevision,expectedSettingsUpdatedAt:review.settingsUpdatedAt,
        expectedRevisions:review.locations.map(l=>({agreementId:l.agreementId,revision:l.revision})),
        choices:review.locations.map(l=>({agreementId:l.agreementId,decisions:{delivery:"NOT_APPLICABLE" as const,
          installation:"NOT_APPLICABLE" as const,removal:"NOT_APPLICABLE" as const,damageWaiver:"NOT_APPLICABLE" as const},
          exceptionReasons:{},retailDeliveryEvent:event(l.agreementId)})),
        reason:"Owner reviewed the pickup order's delivery fee for the synthetic test",
      });
    };
    try{
      await recordMandatorySigningPolicy(owner,{effectiveFromKey:"2026-10-14",
        reason:"Synthetic internal test: retail delivery fee required on deliveries",
        decisions:{delivery:"NOT_APPLICABLE",installation:"NOT_APPLICABLE",removal:"NOT_APPLICABLE",
          damageWaiver:"NOT_APPLICABLE",retailDelivery:"REQUIRED"}});
      const agreements=await prisma.rentalAgreement.findMany({where:{sourceEstimateId:estimateId},
        select:{id:true,serviceAddressId:true}});
      const idFor=(address:string)=>agreements.find(a=>a.serviceAddressId===address)!.id;
      // One address delivered, one picked up: the fee can't go on the pickup, and the delivery must carry it.
      await setChoices("DELIVER","CUSTOMER_PICKUP");
      await expect(save(id=>id===idFor(addressB))).rejects.toThrow(/customer pickup has no delivery/);
      await expect(save(()=>false)).rejects.toThrow(/exactly one/);
      // Everything picked up: no fee event at all, and each address records "no retail delivery fee".
      await setChoices("CUSTOMER_PICKUP","CUSTOMER_PICKUP");
      await expect(save(id=>id===idFor(addressA))).rejects.toThrow(/customer pickup has no delivery/);
      await save(()=>false);
      for(const agreement of await prisma.rentalAgreement.findMany({where:{sourceEstimateId:estimateId}})){
        const latest=(agreement.mandatoryChargeReviewVersions as Array<Record<string,unknown>>).at(-1)!;
        expect(latest.retailDelivery).toMatchObject({event:false,status:"EXEMPT",amountCents:0});
      }
    }finally{
      await prisma.businessSettings.update({where:{id:"singleton"},data:{signingMandatoryPolicyVersions:prior as never}});
      await prisma.estimate.update({where:{id:estimateId},data:{deliveryZoneSnapshot:(priorZone===null?Prisma.DbNull:priorZone) as never}});
    }
  });
  it("leaves an already sent agreement's refundable reserve immutable",async()=>{
    const a=ids[0];
    await prisma.rentalAgreement.update({where:{id:a},data:{status:"AWAITING_SIGNATURE"}});
    await expect(prisma.rentalAgreement.update({where:{id:a},data:{
      depositCents:9999}})).rejects.toThrow();
    const overview=await getPreparedReserveOverview(estimateId);
    expect(overview?.reasons.join(" ")).toMatch(/draft/);
    const fresh=await snapshot();
    await expect(savePreparedCommercialReserveAllocation({
      actorUserId:owner,estimateId,
      expectedEstimateUpdatedAt:new Date(fresh.overview.estimateUpdatedAt),
      expectedRevisions:fresh.expectedRevisions,allocations:fresh.allocations,
      reason:"Attempt to change a customer's already sent signed terms"}))
      .rejects.toThrow(/prepared agreement set/i);
  });
});
