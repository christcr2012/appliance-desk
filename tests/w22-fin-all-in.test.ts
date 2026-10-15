import { describe, expect, it } from "vitest";
import {
  buildSigningV2Extension, verifySigningV2Extension,
} from "@/domains/billing/signing-v2-lines";
import { nextMandatoryChargeReview } from "@/domains/billing/mandatory-charge-review";
import { nextCommercialReserveRevision } from "@/domains/estimates/commercial-reserve-policy";

const settingsUpdatedAt = "2026-10-15T12:00:00.000Z";
const date = new Date("2026-10-15T12:00:00.000Z");
const setup = { jurisdictionId: "jurisdiction-1", rateVersionId: "version-1",
  taxableCents: 4500, exemptCents: 0, taxCents: 225 };

function reviewedLocation(id: string, amount: number, deposit: number, rdf: number) {
  const reserve = nextCommercialReserveRevision({
    previous: [], estimateId: "estimate-1", agreementId: id,
    amountCents: deposit, replenishment: "QUARTERLY",
    termsReference: "Synthetic approved commercial reserve terms version 1",
    actorUserId: "owner-1", reason: "Synthetic negotiated terms review",
    recordedAt: date,
  });
  const mandatory = nextMandatoryChargeReview({
    previous: [],
    revision: {
      estimateId: "estimate-1", agreementId: id, serviceAddressId: "address-" + id,
      actorUserId: "owner-1", recordedAt: date.toISOString(),
      reason: "Synthetic category-by-category mandatory charge review",
      globalPolicyRevision: 1, settingsUpdatedAt,
      charges: [
        {kind:"delivery", decision:amount>0?"REQUIRED":"NOT_APPLICABLE",
          amountCents:amount, reason:null},
        {kind:"installation", decision:"NOT_APPLICABLE",amountCents:0,reason:null},
        {kind:"removal", decision:"NOT_APPLICABLE",amountCents:0,reason:null},
        {kind:"damageWaiver", decision:"NOT_APPLICABLE",amountCents:0,reason:null},
      ],
      tax: {status:"VERIFIED", taxCents: amount===0?0:375,
        lines: amount===0?[]:[{
          lineKey:"mandatory:delivery",jurisdictionId:"jurisdiction-1",
          rateVersionId:"version-1",category:"DELIVERY_FEE",
          taxableCents:amount,exemptCents:0,taxCents:375,
        }],reasons:[]},
      retailDelivery:{event:rdf>0,status:"APPLIES",amountCents:rdf,
        rateId:"rdf-rate-1",handling:"COLLECT_FROM_CUSTOMER",
        reason:"Synthetic single Colorado retail delivery event"},
      reserveRevision:reserve.current.revision,reserveCents:deposit,
    },
  });
  return {mandatoryHistory:mandatory.versions,reserveHistory:reserve.versions};
}
describe("W-22FIN full V2 money component evidence", () => {
  it("reconciles the original five-machine two-location $456.06 fixture without a second rent invoice credit", () => {
    const a = buildSigningV2Extension({
      agreementId:"A",serviceAddressId:"address-A",estimateId:"estimate-1",
      setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
      setupJurisdictions:[setup],depositCents:10000,
      policyRevision:1,settingsUpdatedAt,...reviewedLocation("A",7500,10000,31),
    });
    const b = buildSigningV2Extension({
      agreementId:"B",serviceAddressId:"address-B",estimateId:"estimate-1",
      setupFeeCents:2250,downPaymentCents:9500,setupTaxCents:225,
      setupJurisdictions:[{...setup,taxableCents:2250,taxCents:225}],
      depositCents:5000,policyRevision:1,settingsUpdatedAt,
      ...reviewedLocation("B",0,5000,0),
    });
    expect([a.allInCents,b.allInCents]).toEqual([28631,16975]);
    expect(a.allInCents + b.allInCents).toBe(45606);
    expect(a.extension.components.find(row=>row.category==="COMMERCIAL_RESERVE")?.amountCents).toBe(10000);
    expect(a.extension.components.find(row=>row.category==="FIRST_MONTH_RENT_ADVANCE")?.amountCents).toBe(6000);
    expect(a.extension.components.find(row=>row.category==="RETAIL_DELIVERY_FEE")?.amountCents).toBe(31);
    expect(b.extension.components.find(row=>row.category==="DELIVERY")?.disposition).toBe("NOT_APPLICABLE");
    expect(verifySigningV2Extension(a.extension,{
      agreementId:"A",setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
      allInCents:28631,
    }).components).toHaveLength(8);
    expect(() => verifySigningV2Extension(a.extension,{
      agreementId:"B",setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
      allInCents:28631,
    })).toThrow();
  });
  it("rejects forged extra amounts, duplicate categories, duplicate tax, missing tax, and unsafe overflows", () => {
    const a = buildSigningV2Extension({
      agreementId:"A",serviceAddressId:"address-A",estimateId:"estimate-1",
      setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
      setupJurisdictions:[setup],depositCents:10000,
      policyRevision:1,settingsUpdatedAt,...reviewedLocation("A",7500,10000,31),
    });
    const checked = (value: typeof a.extension) => verifySigningV2Extension(value,{
      agreementId:"A",setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
      allInCents:28631,
    });
    const copied = () => structuredClone(a.extension);
    const forged = copied(); forged.components[1].amountCents += 1;
    expect(() => checked(forged)).toThrow();
    const duplicate = copied(); duplicate.components[1] = {...duplicate.components[0]};
    expect(() => checked(duplicate)).toThrow();
    const extraTax = copied(); extraTax.taxLines.push(extraTax.taxLines[0]);
    expect(() => checked(extraTax)).toThrow();
    const missingTax = copied(); missingTax.taxLines.splice(0,1);
    expect(() => checked(missingTax)).toThrow();
    const overflow = copied(); overflow.components[0].amountCents = Number.MAX_SAFE_INTEGER;
    expect(() => checked(overflow)).toThrow();
  });
  it("fails closed when a reserve is not backed by immutable attributable terms", () => {
    expect(() => buildSigningV2Extension({
      agreementId:"A",serviceAddressId:"address-A",estimateId:"estimate-1",
      setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
      setupJurisdictions:[setup],depositCents:10000,
      policyRevision:1,settingsUpdatedAt,
      ...{...reviewedLocation("A",7500,10000,31),reserveHistory:[]},
    })).toThrow();
  });
});
import { assembleSigningV2Draft } from "@/domains/billing/signing-v2-draft";
import { buildFrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";
import { verifyFrozenSigningOrder } from "@/domains/billing/signing-frozen-verify";
import { buildFrozenSigningCheckoutPlan } from "@/domains/billing/signing-checkout-plan";

it("freezes both properties in one V2 digest and independently verifies checkout breakdown", () => {
  const x = reviewedLocation("A", 7500, 10000, 31);
  const y = reviewedLocation("B", 0, 5000, 0);
  const draft = assembleSigningV2Draft({
    draft: {
      status:"OWNER_DRAFT_ONLY",reasons:[],eligibleForSigning:false,eligibleForCollection:false,
      sourceFingerprint:"d".repeat(64),draftFingerprint:"a".repeat(64),
      lines:[
        {agreementId:"A",serviceAddressId:"address-A",version:1,
          setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
          allInCandidateCents:10725,jurisdictionEvidence:[setup]},
        {agreementId:"B",serviceAddressId:"address-B",version:1,
          setupFeeCents:2250,downPaymentCents:9500,setupTaxCents:225,
          allInCandidateCents:11975,jurisdictionEvidence:[
            {...setup,taxableCents:2250,taxCents:225},
          ]},
      ],
      totals:{setupFeeCents:6750,downPaymentCents:15500,setupTaxCents:450,
        allInCandidateCents:22700},
    },
    sources:[
      {agreementId:"A",serviceAddressId:"address-A",estimateId:"estimate-1",
        depositCents:10000,...x},
      {agreementId:"B",serviceAddressId:"address-B",estimateId:"estimate-1",
        depositCents:5000,...y},
    ],
    policyRevision:1,settingsUpdatedAt,
  });
  expect(draft.evidenceVersion).toBe(2);
  expect(draft.totals?.allInCandidateCents).toBe(45606);
  const frozen = buildFrozenSigningEvidence(draft);
  expect(frozen.map(line=>line.schemaVersion)).toEqual([2,2]);
  const actual = verifyFrozenSigningOrder(frozen.map(line=>({
    agreementId:line.agreementId, serviceAddressId:line.serviceAddressId,
    version:line.agreementVersion, sourceFingerprint:line.sourceFingerprint,
    setupFeeCents:line.setupFeeCents,downPaymentCents:line.downPaymentCents,
    frozenAt:new Date(),frozenOrderFingerprint:line.orderFingerprint,
    frozenAllInCents:line.allInCents,frozenSetupTaxCents:line.setupTaxCents,
    frozenChargeEvidence:JSON.parse(JSON.stringify(line)),
  })), ["B","A"]);
  const a = buildFrozenSigningCheckoutPlan(actual,"A");
  const b = buildFrozenSigningCheckoutPlan(actual,"B");
  expect(a.evidenceVersion).toBe(2);
  expect(a.allInCents).toBe(28631);
  expect(b.allInCents).toBe(16975);
  expect(a.items.find(i=>i.kind==="REFUNDABLE_RESERVE")?.amountCents).toBe(10000);
  expect(a.items.filter(i=>i.kind==="FIRST_MONTH_DOWN_PAYMENT")).toHaveLength(1);
  expect(a.items.reduce((v,i)=>v+i.amountCents,0)).toBe(28631);
});
import { signedReserveAmount } from "@/domains/billing/signing-reserve-liability";
it("keeps a V2 refundable reserve outside the first invoice advance and refuses forged liabilities", () => {
  const value = buildSigningV2Extension({
    agreementId:"A",serviceAddressId:"address-A",estimateId:"estimate-1",
    setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
    setupJurisdictions:[setup],depositCents:10000,
    policyRevision:1,settingsUpdatedAt,...reviewedLocation("A",7500,10000,31),
  });
  const input = {agreementId:"A",evidenceVersion:2,
    componentEvidence:value.extension,setupFeeCents:4500,
    setupTaxCents:225,downPaymentCents:6000,
    totalCents:28631,agreementDepositCents:10000};
  expect(signedReserveAmount(input)).toBe(10000);
  expect(() => signedReserveAmount({...input,agreementDepositCents:5000})).toThrow();
  expect(() => signedReserveAmount({...input,evidenceVersion:3})).toThrow();
  expect(() => signedReserveAmount({...input,evidenceVersion:1})).toThrow();
  expect(signedReserveAmount({...input,evidenceVersion:1,
    componentEvidence:null,agreementDepositCents:0})).toBe(0);
});

import { assertCurrentSigningPolicyInTx } from "@/domains/billing/signing-business-use-gate";

it("fails closed on synthetic V2 financial approval rather than enabling a live customer signing", async () => {
  const value = buildSigningV2Extension({
    agreementId:"A",serviceAddressId:"address-A",estimateId:"estimate-1",
    setupFeeCents:4500,downPaymentCents:6000,setupTaxCents:225,
    setupJurisdictions:[setup],depositCents:10000,
    policyRevision:1,settingsUpdatedAt,...reviewedLocation("A",7500,10000,31),
  });
  const frozen = {
    schemaVersion:2 as const, agreementId:"A",serviceAddressId:"address-A",
    agreementVersion:1,sourceFingerprint:"a".repeat(64),
    orderFingerprint:"b".repeat(64),setupFeeCents:4500,
    downPaymentCents:6000,setupTaxCents:225,allInCents:28631,
    jurisdictions:[setup],v2Extension:value.extension,
  };
  await expect(assertCurrentSigningPolicyInTx(
    {} as Parameters<typeof assertCurrentSigningPolicyInTx>[0],
    [frozen]
  )).rejects.toThrow(/approved adviser evidence/);
});
