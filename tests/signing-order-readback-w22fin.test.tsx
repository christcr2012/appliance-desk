import { describe,expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { presentReviewedSigningOrder } from "@/domains/billing/signing-order-readback";
import { ReviewedSigningOrder } from "@/components/billing/reviewed-signing-order";
import type { FrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";
const fp="a".repeat(64),source="b".repeat(64);
const line=(agreementId:string,serviceAddressId:string,setupFeeCents:number,setupTaxCents:number,downPaymentCents:number):FrozenSigningEvidence=>({
  schemaVersion:1,agreementId,serviceAddressId,agreementVersion:1,
  sourceFingerprint:source,orderFingerprint:fp,
  setupFeeCents,setupTaxCents,downPaymentCents,
  allInCents:setupFeeCents+setupTaxCents+downPaymentCents,jurisdictions:[],
});
const rows=[line("a","addr-a",4500,300,4000),line("b","addr-b",0,0,6000)];
const addresses=[
  {id:"addr-a",line1:"101 Washer Ln",line2:null,city:"Greeley",state:"CO",zip:"80631"},
  {id:"addr-b",line1:"200 Dryer Rd",line2:null,city:"Evans",state:"CO",zip:"80620"},
];
describe("W-22FIN frozen order cross-address readback",()=>{
  it("reconciles all address and tax/downpayment amounts while identifying this signature",()=>{
    const result=presentReviewedSigningOrder(rows,addresses,"a");
    expect(result.locations).toHaveLength(2);
    expect(result.locations.map(x=>x.current)).toEqual([true,false]);
    expect(result.totals).toEqual({setupFeeCents:4500,setupTaxCents:300,
      downPaymentCents:10000,signingAmountCents:14800});
    const html=renderToStaticMarkup(createElement(ReviewedSigningOrder,{order:result}));
    expect(html).toContain("Combined signing amount across addresses");
    expect(html).toContain("$148");
    expect(html).toContain("101 Washer Ln");
    expect(html).toContain("200 Dryer Rd");
    expect(html).toContain("not a payment receipt");
    expect(html).toContain("this agreement");
  });
  it("fails closed if address ownership/scope cannot be fully resolved",()=>{
    expect(()=>presentReviewedSigningOrder(rows,[addresses[0]],"a")).toThrow();
    expect(()=>presentReviewedSigningOrder(rows,addresses,"foreign")).toThrow();
    expect(()=>presentReviewedSigningOrder([...rows,rows[0]],addresses,"a")).toThrow();
    expect(()=>presentReviewedSigningOrder(rows,[...addresses,addresses[0]],"a")).not.toThrow();
    // Two rentals at one customer-owned address must not be mistaken for a foreign site.
    expect(()=>presentReviewedSigningOrder([
      rows[0],{...rows[1],serviceAddressId:"addr-a"},
    ],[addresses[0]],"a")).not.toThrow();
  });
  it("never accepts mixed order fingerprints, invalid arithmetic or unsafe sums",()=>{
    expect(()=>presentReviewedSigningOrder([rows[0],{...rows[1],orderFingerprint:"c".repeat(64)}],addresses,"a")).toThrow();
    expect(()=>presentReviewedSigningOrder([rows[0],{...rows[1],allInCents:17}],addresses,"a")).toThrow();
    expect(()=>presentReviewedSigningOrder([rows[0],{...rows[1],allInCents:Number.MAX_SAFE_INTEGER,downPaymentCents:Number.MAX_SAFE_INTEGER}],addresses,"a")).toThrow();
  });
});
