import { beforeEach, expect, it, vi } from "vitest";
const calls=vi.hoisted(()=>({approve:vi.fn(),checkout:vi.fn()}));
vi.mock("@/domains/estimates",()=>({approveEstimate:calls.approve,requestEstimateChanges:vi.fn()}));
vi.mock("@/domains/billing/checkout",()=>({createDepositCheckoutSessionForEstimate:calls.checkout}));
vi.mock("@/lib/rate-limit",()=>({isRateLimited:async()=>false}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
import { approveEstimateAction } from "@/app/estimate/[id]/actions";
beforeEach(()=>{vi.clearAllMocks();calls.checkout.mockResolvedValue(null);});
it.each([undefined,"","not-a-fingerprint"])("rejects missing/malformed viewed revision %s without domain or checkout calls",async expectedQuoteFingerprint=>{
  expect(await approveEstimateAction("estimate",{
    approverName:"Quote viewer",approverEmail:"viewer@example.test",expectedQuoteFingerprint,
  })).toMatchObject({status:"error"});
  expect(calls.approve).not.toHaveBeenCalled();
  expect(calls.checkout).not.toHaveBeenCalled();
});
it("forwards the exact viewed fingerprint to locked domain verification",async()=>{
  const expectedQuoteFingerprint="a".repeat(64);
  calls.approve.mockRejectedValueOnce(new Error("The reviewed offer changed."));
  expect(await approveEstimateAction("estimate",{
    approverName:"Quote viewer",approverEmail:"viewer@example.test",expectedQuoteFingerprint,
  })).toMatchObject({status:"error",message:"The reviewed offer changed."});
  expect(calls.approve).toHaveBeenCalledWith("estimate",{
    approverName:"Quote viewer",approverEmail:"viewer@example.test",expectedQuoteFingerprint,ipAddress:null,
    // FEETAX-1: the action also forwards the service-choice fields (empty when the customer picked none).
    deliverySelection:undefined,serviceChoices:undefined,serviceDryerOutlet:null,
  });
  expect(calls.checkout).not.toHaveBeenCalled();
});
