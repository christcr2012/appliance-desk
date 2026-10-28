import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { seedTaxReadyContext } from "./tax-ready";
import { nextCommercialReserveRevision } from "@/domains/estimates/commercial-reserve-policy";
import { nextMandatoryChargeReview } from "@/domains/billing/mandatory-charge-review";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";
import { getDraftSigningTaxReviewInTx } from "@/domains/billing/signing-charge-tax-review";
// firstDeliveryCents: the reviewed delivery charge for the first address (7500 by default; 0 = no delivery charge).
export async function createSyntheticW22V2Order(options:{customerId?:string;firstDeliveryCents?:7500|0}={}) {
 const firstDelivery=options.firstDeliveryCents??7500;
 const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
 if(process.env.CI!=="true"||url.pathname!=="/appliance_desk_test"||!["localhost","127.0.0.1"].includes(url.hostname))
   throw new Error("Synthetic V2 fixtures require the isolated disposable test database.");
 const tag=randomUUID().replaceAll("-","");const day=businessDateKey(new Date());
 let owner="",orderFingerprint="",taxDecisionId="";
 const ids:string[]=[];const cleanups:Array<()=>Promise<void>>=[];
  owner=(await prisma.user.findFirstOrThrow({where:{role:"OWNER"}})).id;
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  const previousPolicy=settings.signingMandatoryPolicyVersions;const previousElection=settings.shortTermLeaseElection;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   signingMandatoryPolicyVersions:[{revision:1,effectiveFromKey:day,recordedAt:new Date().toISOString(),recordedByUserId:owner,
    reason:"Synthetic isolated mandatory categories",decisions:{delivery:"REQUIRED",installation:"NOT_APPLICABLE",removal:"NOT_APPLICABLE",damageWaiver:"NOT_APPLICABLE",retailDelivery:"REQUIRED"}}],
  }});
  taxDecisionId=(await prisma.setupFeeTaxDecisionVersion.create({data:{treatment:"TAXABLE",effectiveFromKey:day,cpaConfirmedOnKey:day,
   decisionNote:"Synthetic taxable setup test decision",adviserReference:"Synthetic CPA test fixture only",ownerUserId:owner}})).id;
  const user=options.customerId?null:await prisma.user.create({data:{email:`v2-flow-${tag}@test.invalid`,role:"CUSTOMER",emailVerified:true}});
  const customer=options.customerId?await prisma.customer.findUniqueOrThrow({where:{id:options.customerId}}):await prisma.customer.create({data:{userId:user!.id,referralCode:`V2-${tag}`,isBusiness:true}});
  const previousBusiness=customer.isBusiness;
  if(!previousBusiness)await prisma.customer.update({where:{id:customer.id},data:{isBusiness:true}});
  const estimate=await prisma.estimate.create({data:{customerId:customer.id,title:"Synthetic V2 two property",createdByUserId:owner,depositCents:15000}});
  const sources=[];
  const now=new Date();
  for(let i=0;i<2;i++){
   const address=await prisma.serviceAddress.create({data:{customerId:customer.id,line1:`${i+1} Synthetic V2 Way`,city:"Greeley",zip:"80631"}});
   const tax=await seedTaxReadyContext(address.id,{rateMilliPercent:i===0?5000:10000});cleanups.push(tax.cleanup);
   await prisma.taxabilityRule.update({where:{jurisdictionId_category:{jurisdictionId:tax.jurisdictionId,category:"RENTAL"}},data:{taxability:"EXEMPT",reason:"Synthetic rental exemption for the 45606-cent acceptance fixture"}});
   await prisma.taxabilityRule.update({where:{jurisdictionId_category:{jurisdictionId:tax.jurisdictionId,category:"ADMINISTRATIVE_SETUP"}},data:{cpaConfirmedOn:new Date("2020-01-01T00:00:00Z"),updatedByUserId:owner}});
   const agreement=await prisma.rentalAgreement.create({data:{customerId:customer.id,serviceAddressId:address.id,sourceEstimateId:estimate.id,
    depositCents:i===0?10000:5000}});ids.push(agreement.id);
   const reserve=nextCommercialReserveRevision({previous:[],estimateId:estimate.id,agreementId:agreement.id,amountCents:agreement.depositCents,
    replenishment:"QUARTERLY",termsReference:"Synthetic negotiated reserve terms",actorUserId:owner,reason:"Synthetic reserve terms for isolated proof",recordedAt:now});
   const rent=i===0?6000:9500;const setup=i===0?4500:2250;const delivery=i===0?firstDelivery:0;
   const type=await prisma.applianceType.findFirstOrThrow();
   const pack=await prisma.rentalPackage.create({data:{name:`Synthetic pair ${tag}-${i}`,slug:`synthetic-pair-${tag}-${i}`,monthlyPriceCents:6000,
    components:{create:{applianceTypeId:type.id,quantity:2}}}});
   const pairs=[{packageId:pack.id,amount:6000}];
   if(i===1){const single=await prisma.rentalPackage.create({data:{name:`Synthetic single ${tag}`,slug:`synthetic-single-${tag}`,monthlyPriceCents:3500,
     components:{create:{applianceTypeId:type.id,quantity:1}}}});pairs.push({packageId:single.id,amount:3500});}
   for(const item of pairs){
    await prisma.rentalLine.create({data:{agreementId:agreement.id,label:"Synthetic priced machine package",packageId:item.packageId,
      monthlyPriceCents:item.amount,listPriceCents:item.amount}});
    await prisma.estimateLineItem.create({data:{estimateId:estimate.id,serviceAddressId:address.id,description:"Synthetic priced machine package",
      packageId:item.packageId,monthlyPriceCents:item.amount,quantity:1}});
   }
   sources.push({agreement,address,tax,reserve,rent,setup,delivery});
  }
  // All review/snapshot sources share the final singleton revision after tax fixture setup.
  const current=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  for(const [i,x] of sources.entries()){
   const mandatory=nextMandatoryChargeReview({previous:[],revision:{
    estimateId:estimate.id,agreementId:x.agreement.id,serviceAddressId:x.address.id,actorUserId:owner,recordedAt:now.toISOString(),
    reason:"Synthetic reviewed all-in category allocation",globalPolicyRevision:1,settingsUpdatedAt:current.updatedAt.toISOString(),
    charges:[{kind:"delivery",amountCents:x.delivery,decision:x.delivery?"REQUIRED":"NOT_APPLICABLE",reason:null},
     {kind:"installation",amountCents:0,decision:"NOT_APPLICABLE",reason:null},{kind:"removal",amountCents:0,decision:"NOT_APPLICABLE",reason:null},
     {kind:"damageWaiver",amountCents:0,decision:"NOT_APPLICABLE",reason:null}],
    tax:{status:"VERIFIED",taxCents:x.delivery?375:0,reasons:[],lines:x.delivery?[{lineKey:"mandatory:delivery",jurisdictionId:x.tax.jurisdictionId,
     rateVersionId:x.tax.rateVersionId,category:"DELIVERY",taxableCents:7500,exemptCents:0,taxCents:375}]:[]},
    retailDelivery:{event:i===0,status:i===0?"APPLIES":"EXEMPT",amountCents:i===0?31:0,rateId:i===0?"synthetic-rdf":null,
     handling:"COLLECT_FROM_CUSTOMER",reason:"Synthetic single event allocation only"},reserveCents:x.agreement.depositCents,reserveRevision:1,
   }});
   await prisma.rentalAgreement.update({where:{id:x.agreement.id},data:{commercialReservePolicyVersions:x.reserve.versions,mandatoryChargeReviewVersions:mandatory.versions}});
   await prisma.agreementSigningCharge.create({data:{agreementId:x.agreement.id,sourceEstimateId:estimate.id,serviceAddressId:x.address.id,
    machineCount:i===0?2:3,firstMonthRentCents:x.rent,setupFeeCents:x.setup,downPaymentCents:x.rent,signingSubtotalCents:x.setup+x.rent,
    setupFeeTaxTreatment:"TAXABLE",settingsUpdatedAt:current.updatedAt,sourceFingerprint:"e".repeat(64),createdByUserId:owner}});
  }
  const prepared=await prisma.$transaction(tx=>getDraftSigningTaxReviewInTx(tx,ids[0],new Date()));
  if(prepared.reasons.length)throw new Error(prepared.reasons.join("; "));
  orderFingerprint=(await freezeReviewedSigningOrder(owner,ids[0])).orderFingerprint;
 return {owner,ids,orderFingerprint,customerId:customer.id,estimateId:estimate.id,day,tag,
   cleanup:async()=>{
     if(!previousBusiness)await prisma.customer.update({where:{id:customer.id},data:{isBusiness:previousBusiness}});
     await prisma.businessSettings.update({where:{id:"singleton"},data:{signingMandatoryPolicyVersions:previousPolicy as Prisma.InputJsonValue,shortTermLeaseElection:previousElection}});
     await prisma.setupFeeTaxDecisionVersion.delete({where:{id:taxDecisionId}});
   }};
}
