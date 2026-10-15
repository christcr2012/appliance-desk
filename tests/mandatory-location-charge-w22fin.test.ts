import { describe,expect,it } from "vitest";
import {
  mandatoryChargeAmounts,mandatoryReviewFingerprint,
  nextMandatoryChargeReview,readMandatoryChargeHistory,
  validateLocalChargeChoice,
} from "@/domains/billing/mandatory-charge-review";
import { allocateReviewedRdfForLocation } from
  "@/domains/billing/mandatory-charge-assessment";
import { computeTax } from "@/domains/tax/engine";

const global={
  delivery:"REQUIRED",installation:"NOT_APPLICABLE",
  removal:"NOT_APPLICABLE",damageWaiver:"NOT_APPLICABLE",
  retailDelivery:"REQUIRED",
} as const;
const location={
  agreementId:"agreement-A",decisions:{
    delivery:"REQUIRED",installation:"NOT_APPLICABLE",
    removal:"NOT_APPLICABLE",damageWaiver:"NOT_APPLICABLE",
  },
  exceptionReasons:{},retailDeliveryEvent:true,
} as const;
const settings={
  delivery:7500,installation:0,removal:0,waiverEnabled:false,
};
const fixedDate="2026-10-15T10:00:00.000Z";
describe("W-22FIN owner-reviewed mandatory location policy",()=>{
  it("preserves true service decisions and integer cents without browser prices",()=>{
    const choice=validateLocalChargeChoice(location,global);
    const fees=mandatoryChargeAmounts({global,choice,settings,agreementWaiverCents:0});
    expect(fees.map(item=>item.amountCents)).toEqual([7500,0,0,0]);
    expect(fees[0]).toMatchObject({kind:"delivery",decision:"REQUIRED",reason:null});
    expect(()=>validateLocalChargeChoice({...location,agreementId:""},global)).toThrow();
    expect(()=>validateLocalChargeChoice({...location,decisions:{...location.decisions,
      installation:"REQUIRED"}},global)).toThrow(/contrary to policy/);
  });
  it("permits justified no-delivery and rejects unexplained exceptions",()=>{
    const input={...location,decisions:{...location.decisions,delivery:"NOT_APPLICABLE"}};
    expect(()=>validateLocalChargeChoice(input,global)).toThrow(/Record why/);
    const choice=validateLocalChargeChoice({...input,
      exceptionReasons:{delivery:"Property already has the agreed delivery equipment"}},global);
    expect(mandatoryChargeAmounts({global,choice,settings,agreementWaiverCents:0}))
      .toMatchObject([{amountCents:0,reason:"Property already has the agreed delivery equipment"}]);
  });
  it("refuses an unknown global decision or invented zero-price mandatory fee",()=>{
    expect(()=>validateLocalChargeChoice(location,{...global,delivery:"UNDECIDED"}))
      .toThrow(/resolve the effective global/);
    const choice=validateLocalChargeChoice(location,global);
    expect(()=>mandatoryChargeAmounts({global,choice,
      settings:{...settings,delivery:0},agreementWaiverCents:0}))
      .toThrow(/positive amount/);
    expect(()=>mandatoryChargeAmounts({global,choice,
      settings:{...settings,delivery:7500.5},agreementWaiverCents:0})).toThrow(/Invalid/);
  });
  it("preserves per-jurisdiction integer-cent tax and disputed home-rule treatment",()=>{
    const source={
      taxDate:new Date(fixedDate),leaseTermMonths:12,
      election:"COLLECT_ON_RENTALS" as const,
      defaultRules:{DELIVERY:"TAXABLE" as const},
      jurisdictions:[{
        id:"state",code:"CO",name:"Synthetic Colorado",
        administration:"STATE_COLLECTED" as const,
        rate:{versionId:"rate-A",rateMilliPercent:5000},rules:{},
      },{
        id:"city",code:"GREELEY",name:"Synthetic self-collected city",
        administration:"SELF_COLLECTED" as const,
        rate:{versionId:"rate-B",rateMilliPercent:10000},
        rules:{DELIVERY:"TAXABLE" as const},
      }],
      exemptJurisdictionIds:new Set<string>(),
      lines:[{key:"mandatory:delivery",kind:"DELIVERY_FEE" as const,amountCents:7500}],
    };
    const tax=computeTax(source);
    expect(tax).toMatchObject({ok:true,totalTaxCents:1125});
    if(tax.ok){
      expect(tax.lines.map(row=>row.taxCents)).toEqual([375,750]);
      expect(tax.lines.map(row=>row.rateVersionId)).toEqual(["rate-A","rate-B"]);
    }
    const unknown=computeTax({...source,jurisdictions:source.jurisdictions.map(row=>
      row.id==="city"?{...row,rules:{}}:row)});
    expect(unknown.ok).toBe(false);
  });
  it("assigns a synthetic RDF event exactly once, never as a hidden rent credit",()=>{
    const assessed={status:"APPLIES" as const,amountCents:31,
      rateId:"synthetic-2026",handling:"COLLECT_FROM_CUSTOMER" as const,
      reason:"Synthetic reviewed fee event"};
    expect(allocateReviewedRdfForLocation(assessed,"REQUIRED",true))
      .toMatchObject({status:"APPLIES",amountCents:31,rateId:"synthetic-2026"});
    expect(allocateReviewedRdfForLocation(assessed,"REQUIRED",false))
      .toMatchObject({status:"APPLIES",amountCents:0});
    expect(allocateReviewedRdfForLocation({...assessed,handling:"PAY_MYSELF"},"REQUIRED",true))
      .toMatchObject({status:"APPLIES",amountCents:31,handling:"PAY_MYSELF"});
    expect(allocateReviewedRdfForLocation(assessed,"EXEMPT",true).status).toBe("UNDECIDED");
  });
  it("versions all source classifications, tax evidence and reserve basis",()=>{
    const choice=validateLocalChargeChoice(location,global);
    const charges=mandatoryChargeAmounts({global,choice,settings,agreementWaiverCents:0});
    const revision={
      estimateId:"estimate-A",agreementId:"agreement-A",serviceAddressId:"address-A",
      actorUserId:"owner",recordedAt:fixedDate,reason:"Owner reviewed required delivery by address",
      globalPolicyRevision:1,settingsUpdatedAt:fixedDate,
      charges,tax:{status:"VERIFIED" as const,taxCents:375,
        lines:[{lineKey:"mandatory:delivery",jurisdictionId:"state",rateVersionId:"rate-A",
          category:"DELIVERY",taxableCents:7500,exemptCents:0,taxCents:375}],reasons:[]},
      retailDelivery:{event:true,status:"APPLIES" as const,amountCents:31,rateId:"rate-RDF",
        handling:"COLLECT_FROM_CUSTOMER" as const,reason:"Reviewed synthetic fee"},
      reserveRevision:1,reserveCents:10000,
    };
    const first=nextMandatoryChargeReview({previous:[],revision});
    expect(first.current).toMatchObject({revision:1,professionalReview:"REVIEW_REQUIRED",
      reserveCents:10000,sourceFingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(mandatoryReviewFingerprint(revision)).toBe(first.current.sourceFingerprint);
    expect(nextMandatoryChargeReview({previous:first.versions,revision}).changed).toBe(false);
    const next=nextMandatoryChargeReview({previous:first.versions,
      revision:{...revision,charges:charges.map(x=>x.kind==="delivery"?
        {...x,amountCents:8000}:x)}});
    expect(next.current.revision).toBe(2);
    expect(readMandatoryChargeHistory(next.versions)).toHaveLength(2);
    const damaged=JSON.parse(JSON.stringify(first.versions));
    damaged[0].charges[0].amountCents=1;
    expect(()=>readMandatoryChargeHistory(damaged)).toThrow(/fingerprint/);
    expect(()=>nextMandatoryChargeReview({previous:first.versions,revision:{
      ...revision,agreementId:"foreign-agreement",
    }})).toThrow(/does not belong/);
  });
});
