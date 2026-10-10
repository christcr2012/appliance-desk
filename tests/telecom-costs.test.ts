import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { estimateKnownTelecomCosts, reconcileVerifiedTelecomStatement,
  summarizeProviderUsage, summarizeResourceCosts, type UsageCostObservation } from "@/domains/messaging/telecom-costs";
import { previewTelecomCostAlerts, RECOMMENDED_TELECOM_ALERT_RULES } from "@/domains/messaging/telecom-alerts";

const d=(s:string)=>new Date(s+"T00:00:00Z");
const dec=(s:string)=>new Prisma.Decimal(s);
function usage(category:string,first:string,last:string,price:string|null,
  observed="2026-10-09T00:00:00Z", isTotal=category==="totalprice"):UsageCostObservation {
  return { id:category+"-"+first+"-"+observed,category,startDate:d(first),endDate:d(last),
    price:price===null?null:dec(price),currency:"USD",isTotal,
    providerAsOf:new Date(observed),capturedAt:new Date(observed) };
}
describe("COM-L12 provider cost evidence",()=>{
  it("picks one exact GMT total, not daily/monthly or parent/child double sums",()=>{
    const rows=[
      usage("totalprice","2026-10-01","2026-10-02","10.005"),
      usage("totalprice","2026-10-01","2026-10-01","2"),
      usage("totalprice","2026-10-02","2026-10-02","3"),
      usage("sms-inbound","2026-10-01","2026-10-02","2.5"),
      usage("sms-outbound","2026-10-01","2026-10-02","4"),
      usage("calls-inbound","2026-10-01","2026-10-02","1"),
      usage("sms","2026-10-01","2026-10-02","8",undefined,false),
    ];
    const x=summarizeProviderUsage(rows,d("2026-10-01"),d("2026-10-02"));
    expect(x).toMatchObject({
      complete:true,coverage:"EXACT_GMT_PERIOD",accountTotalCents:1001,
      residualCents:251,unknownCategories:["sms"],
      breakdownCents:{"sms-inbound":250,"sms-outbound":400,"calls-inbound":100},
    });
  });
  it("requires each full GMT day when an exact provider period is absent",()=>{
    const s=summarizeProviderUsage([
      usage("totalprice","2026-10-01","2026-10-01","1.234"),
      usage("totalprice","2026-10-02","2026-10-02","-0.234"),
      usage("sms-outbound","2026-10-01","2026-10-02","0.5"),
    ],d("2026-10-01"),d("2026-10-02"));
    expect(s.accountTotalCents).toBe(100);
    expect(s.coverage).toBe("COMPLETE_GMT_DAYS");
    expect(s.residualCents).toBeNull(); // Breakdown not comparable by matching period
    const missing=summarizeProviderUsage([
      usage("totalprice","2026-10-01","2026-10-01","1"),
    ],d("2026-10-01"),d("2026-10-02"));
    expect(missing.accountTotalCents).toBeNull();
    expect(missing.complete).toBe(false);
  });
  it("newest correction wins, including a late null/unknown price",()=>{
    const old=usage("totalprice","2026-10-01","2026-10-02","7");
    const updated=usage("totalprice","2026-10-01","2026-10-02",null,"2026-10-10T00:00:00Z");
    expect(summarizeProviderUsage([old,updated],d("2026-10-01"),d("2026-10-02")).complete).toBe(false);
    expect(()=>summarizeProviderUsage([{...old,currency:"EUR"},updated],
      d("2026-10-01"),d("2026-10-02"))).toThrow("INCOMPARABLE_PROVIDER_CURRENCY");
  });
  it("never combines superseded, incompatible cost evidence or attributed and unallocated facts",()=>{
    const fact=(classification:"ESTIMATED"|"PROVIDER_REPORTED"|"INVOICE_RECONCILED",
      amount:string, messageAttemptId:string|null, supersededBy:null|{id:string}=null)=>({
      amount:dec(amount),classification,currency:"USD",messageAttemptId,callLegId:null,supersededBy,
    });
    const summary=summarizeResourceCosts([
      fact("PROVIDER_REPORTED","0.03","attempt-1",{id:"new"}),
      fact("PROVIDER_REPORTED","0.04","attempt-1"),
      fact("PROVIDER_REPORTED","-0.005",null),
      fact("ESTIMATED","0.08","attempt-1"),
      fact("INVOICE_RECONCILED","0.10",null),
    ]);
    expect(summary).toMatchObject({estimatedCents:8,providerReportedCents:4,
      providerAttributedCents:4,providerUnallocatedCents:-1,invoiceFactCents:10});
  });
  it("estimates only explicitly priced quantities, keeping fees and taxes unknown",()=>{
    const e=estimateKnownTelecomCosts([
      {component:"sms",quantity:"3",unitPrice:"0.0083000000"},
      {component:"carrier",quantity:"3",unitPrice:null},
      {component:"credit",quantity:"1",unitPrice:"-0.0010000000"},
    ],"USD",false);
    expect(e.knownCents).toBe(2);
    expect(e.complete).toBe(false);
    expect(e.missing).toContain("carrier");
    expect(e.missing).toContain("UNVERIFIED_PROVIDER_FEES_AND_TAXES");
    expect(estimateKnownTelecomCosts([{component:"sms",quantity:null,unitPrice:null}],
      "USD",false).knownCents).toBeNull();
  });
  it("respects distinct statement basis, signs and explicit ANY/ALL tolerances",()=>{
    const statement={invoiceTotalCents:10000,currency:"USD"};
    const any=reconcileVerifiedTelecomStatement(10350,"USD",statement,{
      absoluteCents:400,percentBasisPoints:300,combination:"ANY",
    });
    const all=reconcileVerifiedTelecomStatement(10350,"USD",statement,{
      absoluteCents:400,percentBasisPoints:300,combination:"ALL",
    });
    expect(any).toMatchObject({differenceCents:350,mismatch:true});
    expect(all.mismatch).toBe(false);
    expect(reconcileVerifiedTelecomStatement(null,null,statement,{
      absoluteCents:0,percentBasisPoints:null,combination:"ANY",
    }).mismatch).toBeNull();
    expect(()=>reconcileVerifiedTelecomStatement(10000,"EUR",statement,{
      absoluteCents:0,percentBasisPoints:null,combination:"ANY",
    })).toThrow("INCOMPARABLE_STATEMENT_CURRENCY");
  });
  it("never sends alerts; stale, unknown and pending IN-53 remain preview-only",()=>{
    const now=new Date("2026-10-09T13:00:00Z");
    const input={
      rules:RECOMMENDED_TELECOM_ALERT_RULES,currentCents:10000,currentComplete:true,
      previousCents:5000,previousComplete:true,sameLengthWindow:true,
      lastUsageSyncAt:new Date("2026-10-09T12:00:00Z"),now,
      invoiceMismatch:true,unknownCategories:["unmapped-provider-category"],
    };
    const res=previewTelecomCostAlerts(input);
    expect(res.activation).toBe("OFF");
    expect(res.candidates).toContain("BUDGET_CRITICAL");
    expect(res.candidates).toContain("COST_SPIKE");
    expect(res.candidates).toContain("INVOICE_DIFFERENCE");
    expect(res.candidates).toContain("UNKNOWN_USAGE_CATEGORY");
    const stale=previewTelecomCostAlerts({...input,lastUsageSyncAt:null});
    expect(stale.candidates).toContain("USAGE_NEVER_SYNCED");
    expect(stale.candidates).not.toContain("BUDGET_CRITICAL");
    expect(stale.budgetRemainingCents).toBeNull();
  });
});
