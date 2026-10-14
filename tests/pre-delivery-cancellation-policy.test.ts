import { describe, expect, it } from "vitest";
import { calculatePreDeliveryCancellationAmounts } from "@/domains/agreements/pre-delivery-cancellation";
const signedAt=new Date("2026-10-13T12:00:00Z");
const base={receivedCents:10500,setupFeeCents:4500,setupTaxCents:0,downPaymentCents:6000,signedAt,hours:72};
describe("approved pre-delivery refund policy",()=>{
 it("ordinary order refunds everything even after 72h",()=>{
  const out=calculatePreDeliveryCancellationAmounts({...base,downPaymentCents:0,receivedCents:4500,now:new Date("2026-10-20"),policy:"FULL_REFUND"});
  expect(out).toMatchObject({refundableCents:4500,retainedCents:0,largeOrder:false});
 });
 it("large order within configured window must be fully refunded",()=>{
  expect(()=>calculatePreDeliveryCancellationAmounts({...base,now:new Date("2026-10-14"),policy:"RETAIN_SETUP"})).toThrow(/must return the full/);
 });
 it("outside large-order window may retain setup, never more than receipt",()=>{
  const out=calculatePreDeliveryCancellationAmounts({...base,now:new Date("2026-10-20"),policy:"RETAIN_SETUP"});
  expect(out).toMatchObject({refundableCents:6000,retainedCents:4500});
 });
 it("owner may override with full refund even outside window",()=>{
  expect(calculatePreDeliveryCancellationAmounts({...base,now:new Date("2026-10-20"),policy:"FULL_REFUND"}).refundableCents).toBe(10500);
 });
 it("cannot retain a fee larger than actually received",()=>{
  expect(()=>calculatePreDeliveryCancellationAmounts({...base,receivedCents:1000,now:new Date("2026-10-20"),policy:"RETAIN_SETUP"})).toThrow(/reconciliation/);
 });
});
