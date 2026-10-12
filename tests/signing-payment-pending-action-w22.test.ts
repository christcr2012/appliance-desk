import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  sign: vi.fn(), agreement: vi.fn(), checkout: vi.fn(), reviewed: vi.fn(), renewal: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(async () => false) }));
vi.mock("@/domains/agreements", () => ({ signAgreement: (...a: unknown[]) => f.sign(...a) }));
vi.mock("@/domains/billing/checkout", () => ({ createCheckoutSessionForAgreement: (...a: unknown[]) => f.checkout(...a) }));
vi.mock("@/domains/billing/signing-payment-readiness", () => ({ getReviewedSigningPayment: (...a: unknown[]) => f.reviewed(...a) }));
vi.mock("@/domains/agreements/renewal-start", () => ({ startRenewalIfDue: (...a: unknown[]) => f.renewal(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { rentalAgreement: { findUnique: (...a: unknown[]) => f.agreement(...a) } } }));
import { signAgreementAction } from "@/app/sign/[id]/actions";
const signedInput = { signerName: "Customer Name", signerEmail: "c@example.test", agreedToTerms: true };
beforeEach(() => {
  Object.values(f).forEach(mock => mock.mockReset());
  f.sign.mockResolvedValue("agr-1");
  f.agreement.mockResolvedValue({ renewedFromAgreementId: null,
    signingChargeSnapshot: {id: "w22"}, signature: {signingOrderFingerprint: "a".repeat(64), signingAllInCents: 7500} });
  f.reviewed.mockResolvedValue({customerId:"cust-1", agreementId:"agr-1", plan:{ allInCents:7500 }});
  f.checkout.mockResolvedValue("https://example.test/checkout");
});
describe("W-22 signing completion payment status", () => {
  it("returns the exact outstanding signed amount without any legacy checkout call", async () => {
    const r = await signAgreementAction("sig-1", signedInput);
    expect(r).toMatchObject({ status:"success", agreementId:"agr-1", checkoutUrl:null, pendingSigningAmountCents:7500 });
    expect(f.reviewed).toHaveBeenCalledWith("agr-1");
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it("makes a mismatched payment proof visible as review-required, never a paid claim", async () => {
    f.reviewed.mockRejectedValue(new Error("order mismatch"));
    expect(await signAgreementAction("sig-1", signedInput)).toMatchObject({
      status:"success", checkoutUrl:null, paymentNeedsReview:true,
    });
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it("returns zero charge without claiming that rent was paid", async () => {
    f.reviewed.mockResolvedValue({plan:{allInCents:0}});
    expect(await signAgreementAction("sig-1", signedInput)).toMatchObject({status:"success", pendingSigningAmountCents:0});
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it("keeps historical no-W-22 checkout path", async () => {
    f.agreement.mockResolvedValue({ renewedFromAgreementId: null, signingChargeSnapshot:null, signature:null });
    expect(await signAgreementAction("sig-1", signedInput)).toMatchObject({status:"success",checkoutUrl:"https://example.test/checkout"});
    expect(f.reviewed).not.toHaveBeenCalled();
    expect(f.checkout).toHaveBeenCalledWith("agr-1");
  });
  it("does not create another checkout for a renewal", async () => {
    f.agreement.mockResolvedValue({ renewedFromAgreementId:"old", signingChargeSnapshot:null, signature:null });
    expect(await signAgreementAction("sig-1", signedInput)).toMatchObject({status:"success",checkoutUrl:null});
    expect(f.renewal).toHaveBeenCalledWith("agr-1");
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it("rejects invalid consent before signature", async () => {
    expect(await signAgreementAction("sig-1", {...signedInput,agreedToTerms:false})).toMatchObject({status:"error"});
    expect(f.sign).not.toHaveBeenCalled();
  });
});
