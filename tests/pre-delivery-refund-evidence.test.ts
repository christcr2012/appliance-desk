import { describe, expect, it } from "vitest";
import { validateExternalStripeRefund, validateManualReturn } from "@/domains/agreements/pre-delivery-refund-evidence";
const base={id:"re_test123456",charge:"ch_original",
 amount:10500,currency:"usd",status:"succeeded" as const,
 created:1791870000};
const expected={refundId:base.id,chargeId:base.charge,amountCents:base.amount};
describe("W-22 refund evidence",()=>{
 it("accepts only exact successful provider TEST evidence",()=>{
  expect(validateExternalStripeRefund(base,expected)).toMatchObject({
   originalChargeId:"ch_original",amountCents:10500 ,providerMode:"TEST_KEY",
  });
 });
 it("rejects mismatched amount, charge, mode, currency and pending status",()=>{
  for(const patch of [{amount:10499},{charge:"ch_wrong"},
   {currency:"eur"},{status:"pending"},{id:"re_other"}]) {
    expect(()=>validateExternalStripeRefund({...base,...patch},expected)).toThrow();
  }
 });
 it("manual records require original amount, a reference and confirmed return",()=>{
  expect(validateManualReturn({method:"MANUAL_CHECK",reference:"CHK-987654",
   amountCents:10500,confirmedReturned:true}).reference).toBe("CHK-987654");
  expect(()=>validateManualReturn({method:"MANUAL_CHECK",reference:"",
   amountCents:10500,confirmedReturned:true})).toThrow();
  expect(()=>validateManualReturn({method:"MANUAL_CHECK",reference:"CHK-987654",
   amountCents:10500,confirmedReturned:false})).toThrow();
  expect(()=>validateManualReturn({method:"MANUAL_CHECK",reference:"CHK-987654",
   amountCents:0,confirmedReturned:true})).toThrow();
 });
});
