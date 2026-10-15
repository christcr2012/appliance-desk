import type { Prisma } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import { computeTax } from "@/domains/tax/engine";
import { rdfRateForSale,retailDeliveryFeeStatus } from "@/domains/tax/retail-delivery-fee";
import { recordedRetailSales } from "@/domains/tax/rdf-sales-evidence";
import type {
  MandatoryTaxEvidence,ReviewedMandatoryChargeRevision,
  VerifiedOneTimeCharge,
} from "./mandatory-charge-review";

export async function provisionalMandatoryServiceTaxInTx(
  tx:Prisma.TransactionClient,agreementId:string,
  charges:readonly VerifiedOneTimeCharge[],asOf:Date,
):Promise<MandatoryTaxEvidence>{
  const problems:string[]=[];
  const location=await tx.rentalAgreement.findUniqueOrThrow({
    where:{id:agreementId},select:{
      serviceAddressId:true,
      serviceAddress:{select:{state:true}},
    },
  });
  const verified=await tx.addressTaxLocation.findFirst({
    where:{serviceAddressId:location.serviceAddressId,isCurrent:true},
    select:{status:true,jurisdictions:{select:{
      jurisdiction:{select:{name:true,reviewStatus:true}},
    }}},
  });
  if(!verified||verified.status!=="VERIFIED"||!verified.jurisdictions.length)
    problems.push("Verify all tax jurisdictions for this service address.");
  for(const entry of verified?.jurisdictions??[]){
    if(entry.jurisdiction.reviewStatus!=="REVIEWED")
      problems.push("Professional tax review is pending for "+entry.jurisdiction.name+".");
  }
  const items=charges.filter(row=>row.amountCents>0).map(row=>({
    key:"mandatory:"+row.kind,
    kind:({
      delivery:"DELIVERY_FEE",installation:"INSTALLATION_FEE",
      removal:"REMOVAL_FEE",damageWaiver:"DAMAGE_WAIVER",
    } as const)[row.kind],
    amountCents:row.amountCents,
  }));
  try{
    const context=await getAgreementTaxContext(tx,agreementId,asOf);
    if(!context.jurisdictions.length)
      problems.push("Location lacks a verified, effective-dated tax jurisdiction.");
    // Rate/rule decisions are independent for EACH service category; no
    // implied Colorado/home-rule exemption from a zero setup-tax setting.
    const result=computeTax({...context,lines:items});
    if(!result.ok)problems.push(...result.problems);
    if(problems.length||!result.ok)
      return {status:"REVIEW_REQUIRED",taxCents:null,lines:[],
        reasons:[...new Set(problems)]};
    return {status:"VERIFIED",taxCents:result.totalTaxCents,
      lines:result.lines.map(line=>({
        lineKey:line.lineKey,jurisdictionId:line.jurisdictionId,
        rateVersionId:line.rateVersionId,category:line.category,
        taxableCents:line.taxableCents,exemptCents:line.exemptCents,
        taxCents:line.taxCents,
      })),reasons:[]};
  }catch(error){
    return {status:"REVIEW_REQUIRED",taxCents:null,lines:[],
      reasons:[...new Set([...problems,error instanceof Error?
        error.message:"The effective local tax calculation needs review."])]};
  }
}
export type ProvisionalRdfOrderDecision={
  status:"APPLIES"|"EXEMPT"|"UNDECIDED";
  amountCents:number|null;
  rateId:string|null;
  handling:"COLLECT_FROM_CUSTOMER"|"PAY_MYSELF"|"UNDECIDED";
  reason:string;
};
/**
 * RDF is one Colorado retail-delivery event per qualifying order, not a fee
 * per appliance, per tax jurisdiction or per service address. The owner
 * separately chooses which one location hosts that reviewed event.
 */
export async function provisionalRdfOrderDecisionInTx(
  tx:Prisma.TransactionClient,at:Date,
):Promise<ProvisionalRdfOrderDecision>{
  const settings=await tx.businessSettings.findUniqueOrThrow({
    where:{id:"singleton"},select:{
      shortTermLeaseElection:true,
      rdfThresholdCents:true,rdfThresholdCrossedOn:true,
      rdfHandling:true,rdfCpaConfirmedOn:true,
    },
  });
  const year=Number(businessDateKey(at).slice(0,4));
  const [previous,current,filing,rates]=await Promise.all([
    recordedRetailSales(tx,year-1),recordedRetailSales(tx,year),
    tx.taxFilingAccount.findFirst({
      where:{kind:"SALES_RETURN",jurisdictions:{some:{level:"STATE"}}},
      select:{frequency:true},
    }),
    tx.retailDeliveryFeeRate.findMany({where:{effectiveOn:{lte:at}},
      select:{effectiveOn:true,amountCents:true,id:true},
      orderBy:{effectiveOn:"desc"},take:15}),
  ]);
  const decision=retailDeliveryFeeStatus({
    today:at,saleType:"RENTAL",
    election:settings.shortTermLeaseElection,
    previousYearRetailCents:previous,currentYearRetailCents:current,
    thresholdCents:settings.rdfThresholdCents,
    thresholdCrossedOn:settings.rdfThresholdCrossedOn,
    handling:settings.rdfHandling,cpaConfirmedOn:settings.rdfCpaConfirmedOn,
    frequency:filing?.frequency??"MONTHLY",
  });
  if(decision.status==="UNDECIDED")return {status:"UNDECIDED",amountCents:null,
    rateId:null,handling:settings.rdfHandling,reason:decision.reason};
  if(decision.status!=="APPLIES")
    return {status:"EXEMPT",amountCents:0,rateId:null,
      handling:settings.rdfHandling,reason:decision.reason};
  const rate=rdfRateForSale(at,rates);
  if(!rate)return {status:"UNDECIDED",amountCents:null,rateId:null,
    handling:settings.rdfHandling,
    reason:"Enter and independently verify the Colorado retail delivery fee rate effective for this date."};
  return {status:"APPLIES",amountCents:rate.amountCents,rateId:rate.id,
    handling:settings.rdfHandling,reason:decision.reason};
}
export function allocateReviewedRdfForLocation(
  rdf:ProvisionalRdfOrderDecision,policy:"UNDECIDED"|"REQUIRED"|"EXEMPT",
  selected:boolean,
):ReviewedMandatoryChargeRevision["retailDelivery"]{
  if(policy==="UNDECIDED")return {event:selected,status:"UNDECIDED",
    amountCents:null,rateId:null,handling:rdf.handling,
    reason:"Owner effective-date RDF policy must be reviewed."};
  if(policy==="EXEMPT"){
    if(rdf.status==="APPLIES")return {
      event:selected,status:"UNDECIDED",amountCents:null,rateId:rdf.rateId,
      handling:rdf.handling,
      reason:"Global RDF exemption contradicts the recorded state fee evidence.",
    };
    return {event:false,status:rdf.status==="EXEMPT"?"EXEMPT":"UNDECIDED",
      amountCents:rdf.status==="EXEMPT"?0:null,
      rateId:null,handling:rdf.handling,reason:rdf.reason};
  }
  if(rdf.status!=="APPLIES"||rdf.amountCents===null)
    return {event:selected,status:"UNDECIDED",amountCents:null,rateId:rdf.rateId,
      handling:rdf.handling,reason:"RDF required but state/election/rate evidence is incomplete: "+rdf.reason};
  return {event:selected,status:"APPLIES",
    // PAY_MYSELF is still an RDF liability; NOT an extra customer due.
    amountCents:selected?rdf.amountCents:0,rateId:rdf.rateId,
    handling:rdf.handling,reason:selected?rdf.reason:"Assigned once to another delivery address."};
}
