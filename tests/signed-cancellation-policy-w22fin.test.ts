import { describe, expect, it } from "vitest";
import {
  buildSignedCancellationPolicyEvidence,
  readSignedCancellationPolicyEvidence,
} from "@/domains/agreements/signed-cancellation-policy";

const signedAt = new Date("2026-10-13T12:00:00.000Z");
const fingerprint = "a".repeat(64);
const sample = {
  agreementId: "loc-a", orderFingerprint: fingerprint, signedAt,
  settings: {
    largeOrderMachineThreshold: 5,
    largeOrderCancellationFullRefundHours: 72,
    updatedAt: new Date("2026-10-12T12:00:00.000Z"),
  },
  machines: [
    { agreementId:"loc-b",machineCount:3 },
    { agreementId:"loc-a",machineCount:2 },
  ],
  businessCustomer:false, propertyManagerCustomer:false,
} as const;
const decode = (raw:unknown) => readSignedCancellationPolicyEvidence(raw,{
  agreementId:"loc-a",orderFingerprint:fingerprint,signedAt,
});
describe("W-22FIN original signed cancellation policy evidence",()=>{
  it("freezes all five machines across locations even when the advance is zero",()=>{
    const policy=buildSignedCancellationPolicyEvidence(sample);
    expect(policy).toMatchObject({largeOrder:true,machineThreshold:5,fullRefundHours:72,
      machines:[{agreementId:"loc-a",count:2},{agreementId:"loc-b",count:3}],
      reasons:["MACHINE_THRESHOLD"]});
    expect(decode(JSON.parse(JSON.stringify(policy)))).toEqual(policy);
  });
  it.each(["businessCustomer","propertyManagerCustomer"] as const)(
    "preserves an ordinary single-appliance %s account as large without an advance",key=>{
    const policy=buildSignedCancellationPolicyEvidence({
      ...sample,machines:[{agreementId:"loc-a",machineCount:1}],
      [key]:true,
    });
    expect(policy.largeOrder).toBe(true);
    expect(policy.reasons).toContain(key==="businessCustomer"?"BUSINESS_CUSTOMER":"PROPERTY_MANAGER");
  });
  it("retains original signing window when later settings change",()=>{
    const policy=buildSignedCancellationPolicyEvidence(sample);
    sample.settings.largeOrderCancellationFullRefundHours; // original frozen value
    expect(decode(policy)?.fullRefundHours).toBe(72);
    expect(buildSignedCancellationPolicyEvidence({
      ...sample,settings:{...sample.settings,largeOrderCancellationFullRefundHours:168},
    }).fullRefundHours).toBe(168);
    expect(decode(policy)?.fullRefundHours).toBe(72);
  });
  it("keeps genuine one-machine household ordinary",()=>{
    expect(buildSignedCancellationPolicyEvidence({
      ...sample,machines:[{agreementId:"loc-a",machineCount:1}],
    }).largeOrder).toBe(false);
  });
  it.each(["machine-count","duplicate","foreign","threshold","hours"] as const)(
    "rejects invalid trusted source: %s",issue=>{
    const changes=issue==="machine-count" ? {machines:[{agreementId:"loc-a",machineCount:-1}]} :
      issue==="duplicate" ? {machines:[{agreementId:"loc-a",machineCount:1},{agreementId:"loc-a",machineCount:2}]} :
      issue==="foreign" ? {machines:[{agreementId:"elsewhere",machineCount:2}]} :
      issue==="threshold" ? {settings:{...sample.settings,largeOrderMachineThreshold:0}} :
      {settings:{...sample.settings,largeOrderCancellationFullRefundHours:0}};
    expect(()=>buildSignedCancellationPolicyEvidence({...sample,...changes})).toThrow();
  });
  it.each(["missing-location","changed-reason","changed-window","changed-order","changed-time"] as const)(
    "rejects changed or forged stored policy: %s",kind=>{
    const policy=buildSignedCancellationPolicyEvidence(sample);
    const altered: Record<string,unknown>=JSON.parse(JSON.stringify(policy));
    if(kind==="missing-location") altered.machines=[{agreementId:"loc-b",count:3}];
    if(kind==="changed-reason")altered.reasons=["PROPERTY_MANAGER"];
    if(kind==="changed-window")altered.fullRefundHours=9999;
    if(kind==="changed-order")altered.orderFingerprint="b".repeat(64);
    if(kind==="changed-time")altered.signedAt="2026-10-13T11:00:00.000Z";
    expect(()=>decode(altered)).toThrow(/finance review/);
  });
  it("allows historical null evidence but never treats corruption as legacy",()=>{
    expect(decode(null)).toBeNull();
    expect(()=>decode({})).toThrow(/finance review/);
  });
});
