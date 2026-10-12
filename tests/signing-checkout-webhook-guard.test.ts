import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { assertNoUnsettledW22Checkout } from "@/domains/billing/webhooks-base";
import { captureDepositProvenanceFromWebhook } from "@/domains/billing/deposit-provenance";

describe("W-22 signing sessions cannot enter legacy webhook payment handling", () => {
  const session = (metadata: Record<string, string>) =>
    ({ id: "cs_test_mock", mode: "payment", metadata }) as unknown as Stripe.Checkout.Session;

  it("blocks tagged payment, failure or async settlement even when legacy metadata is also present", () => {
    expect(() => assertNoUnsettledW22Checkout(session({
      agreementId: "agr", attemptId: "attempt", orderFingerprint: "a".repeat(64),
    }))).toThrow(/not active/);
    expect(() => assertNoUnsettledW22Checkout(session({
      estimateId: "est", attemptId: "attempt",
    }))).toThrow(/not active/);
    expect(() => assertNoUnsettledW22Checkout(session({
      agreementId: "agr", orderFingerprint: "a".repeat(64),
    }))).toThrow(/not active/);
  });

  it("does not attribute W-22 paid Checkout to a legacy refundable deposit", async () => {
    const w22 = {
      ...session({ agreementId: "agr", attemptId: "payment-attempt",
        orderFingerprint: "a".repeat(64) }),
      payment_status: "paid", payment_intent: "pi_test_no_legacy_deposit",
    } as Stripe.Checkout.Session;
    await expect(captureDepositProvenanceFromWebhook({
      id: "evt_test_no_legacy_deposit", type: "checkout.session.completed",
      data: { object: w22 },
    } as Stripe.Event)).resolves.toBeUndefined();
  });

  it("does not break untagged legacy estimate or subscription sessions", () => {
    expect(() => assertNoUnsettledW22Checkout(session({ agreementId: "legacy" })))
      .not.toThrow();
    expect(() => assertNoUnsettledW22Checkout(session({ estimateId: "legacy" })))
      .not.toThrow();
  });
});
