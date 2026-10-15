import { describe,expect,it } from "vitest";
import {
  nextCommercialReserveRevision,
  readCommercialReserveHistory,
  validateCommercialReserveProposal,
} from "@/domains/estimates/commercial-reserve-policy";

const at=new Date("2026-10-15T10:00:00.000Z");
const original={
  previous:[],agreementId:"address-one",estimateId:"quote-one",
  amountCents:10000,replenishment:"QUARTERLY" as const,
  termsReference:"Negotiated commercial security reserve; legal review pending",
  actorUserId:"owner-one",reason:"Owner reviewed the negotiated amount and terms",
  recordedAt:at,
};
describe("W-22FIN commercial reserve policy evidence",()=>{
  it("versions a negotiated refundable liability without treating it as money",()=>{
    const first=nextCommercialReserveRevision(original);
    expect(first.changed).toBe(true);
    expect(first.current).toMatchObject({schemaVersion:1,revision:1,
      agreementId:"address-one",amountCents:10000,
      replenishment:"QUARTERLY",professionalReview:"REVIEW_REQUIRED"});
    const identical=nextCommercialReserveRevision({...original,previous:first.versions});
    expect(identical.changed).toBe(false);
    const second=nextCommercialReserveRevision({...original,previous:first.versions,
      amountCents:5000,reason:"Owner negotiated a reduced reserve for this address"});
    expect(second.current.revision).toBe(2);
    expect(second.versions).toHaveLength(2);
    expect(readCommercialReserveHistory(second.versions)[0]).toEqual(first.current);
  });
  it("records explicit no-deposit decisions, never quarterly replenishment of zero",()=>{
    const noReserve=nextCommercialReserveRevision({...original,amountCents:0,
      replenishment:"NONE",termsReference:"This delivery location has no negotiated security reserve"});
    expect(noReserve.current.amountCents).toBe(0);
    expect(noReserve.current.replenishment).toBe("NONE");
    expect(()=>validateCommercialReserveProposal({...noReserve.current,replenishment:"QUARTERLY"}))
      .toThrow(/zero reserve/);
  });
  it("requires owner evidence, a legal reference, nonnegative integer cents, actual dates",()=>{
    expect(()=>nextCommercialReserveRevision({...original,actorUserId:""})).toThrow();
    expect(()=>nextCommercialReserveRevision({...original,reason:"short"})).toThrow();
    expect(()=>nextCommercialReserveRevision({...original,recordedAt:new Date("not a date")})).toThrow();
    for(const amountCents of [-1,10.1,Number.MAX_SAFE_INTEGER]) {
      expect(()=>nextCommercialReserveRevision({...original,amountCents})).toThrow();
    }
    expect(()=>nextCommercialReserveRevision({...original,
      termsReference:"waived"})).toThrow();
  });
  it("rejects corrupt or cross-estimate historical policies without reset",()=>{
    const first=nextCommercialReserveRevision(original);
    expect(()=>nextCommercialReserveRevision({...original,estimateId:"other-quote",
      previous:first.versions})).toThrow(/belong/);
    expect(()=>readCommercialReserveHistory({something:true})).toThrow(/finance review/);
    expect(()=>readCommercialReserveHistory([{schemaVersion:1}])).toThrow(/finance review/);
    expect(()=>readCommercialReserveHistory([{
      ...first.current,revision:3,
    }])).toThrow(/finance review/);
    expect(()=>readCommercialReserveHistory([{
      ...first.current,professionalReview:"APPROVED",
    }])).toThrow(/finance review/);
  });
});
