import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { getAccountingTransactions } from "@/domains/reports/accounting-export";
import { convertEstimateToAgreements } from "@/domains/estimates";

// ---------------------------------------------------------------------------
// Deposit collected at estimate approval (2026-09-29 — see
// docs/ROADMAP.md's "A deposit collected at the moment a quote/estimate
// is approved" entry). Real, database-backed (same pattern and reasoning
// as tests/billing-webhooks.test.ts): only Stripe's own API is faked,
// because the whole point of this suite is proving the actual database
// writes — the deposit gets recorded exactly once, and a later signing
// Checkout for the resulting agreement never tries to collect it again.
// ---------------------------------------------------------------------------

const RUN_ID = Math.random().toString(36).slice(2, 10);

let userId: string;
let staffUserId: string;
let customerId: string;
let serviceAddressId: string;
let estimateId: string;

function fakeEvent(id: string, type: string, object: unknown): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

beforeAll(async () => {
  const staff = await prisma.user.create({
    data: {
      email: `estimate-deposit-staff-${RUN_ID}@example.test`,
      name: "Staff Tester",
      role: "OWNER",
      emailVerified: true,
    },
  });
  staffUserId = staff.id;

  const user = await prisma.user.create({
    data: {
      email: `estimate-deposit-${RUN_ID}@example.test`,
      name: "Estimate Deposit Customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  userId = user.id;

  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: `ESTD${RUN_ID}`.slice(0, 20).toUpperCase() },
  });
  customerId = customer.id;

  const serviceAddress = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: "200 Test Ave", city: "Denver", zip: "80202" },
  });
  serviceAddressId = serviceAddress.id;

  const estimate = await prisma.estimate.create({
    data: {
      customerId: customer.id,
      title: "Deposit test estimate",
      depositCents: 20000,
      status: "SENT",
      sentAt: new Date(),
      createdByUserId: staffUserId,
    },
  });
  estimateId = estimate.id;

  __setStripeClientForTests({
    paymentIntents: {
      retrieve: async (id: string) =>
        ({ payment_method: { id: `pm_from_${id}`, type: "card" } }) as unknown as Stripe.PaymentIntent,
    },
  } as unknown as Stripe);
});

afterAll(async () => {
  __setStripeClientForTests(null);
  await prisma.payment.deleteMany({ where: { invoice: { customerId } } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { customerId } } });
  await prisma.invoice.deleteMany({ where: { customerId } });
  await prisma.deposit.deleteMany({ where: { agreement: { customerId } } });
  await prisma.webhookEvent.deleteMany({
    where: { id: { in: ["evt_estimate_deposit_1", "evt_estimate_deposit_1_retry"] } },
  });
  await prisma.rentalAgreement.deleteMany({ where: { customerId } });
  await prisma.estimate.deleteMany({ where: { customerId } });
  await prisma.serviceAddress.delete({ where: { id: serviceAddressId } });
  await prisma.customer.delete({ where: { id: customerId } });
  // convertEstimateToAgreements (via createDraftAgreement) logs an
  // AuditLog row against staffUserId — clean those up before deleting
  // the users themselves, same pattern as tests/billing-webhooks.test.ts
  // and tests/customer-isolation.test.ts (AuditLog.userId has no
  // cascade/set-null at the database level, so deleting a User with
  // AuditLog rows still pointing at it fails a foreign key check).
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, staffUserId] } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.user.delete({ where: { id: staffUserId } });
});

describe("processStripeWebhookEvent — checkout.session.completed for an estimate deposit", () => {
  it("records a PAID invoice with no agreement attached, a succeeded Payment, and marks the estimate's depositPaidAt", async () => {
    const event = fakeEvent("evt_estimate_deposit_1", "checkout.session.completed", {
      mode: "payment",
      payment_intent: "pi_fake_estimate_deposit",
      payment_status: "paid",
      metadata: { estimateId },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findFirst({
      where: { customerId, payments: { some: { stripePaymentIntentId: "pi_fake_estimate_deposit" } } },
      include: { lineItems: true, payments: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.agreementId).toBeNull();
    expect(invoice!.status).toBe("PAID");
    expect(invoice!.amountPaidCents).toBe(20000);
    expect(invoice!.lineItems).toHaveLength(1);
    expect(invoice!.lineItems[0].kind).toBe("DEPOSIT");
    expect(invoice!.payments[0].status).toBe("succeeded");

    const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
    expect(estimate.depositPaidAt).not.toBeNull();
  });

  it("is idempotent — replaying the same event id records nothing new", async () => {
    const event = fakeEvent("evt_estimate_deposit_1", "checkout.session.completed", {
      mode: "payment",
      payment_intent: "pi_fake_estimate_deposit",
      payment_status: "paid",
      metadata: { estimateId },
    });

    await processStripeWebhookEvent(event);

    const invoices = await prisma.invoice.findMany({ where: { customerId } });
    expect(invoices).toHaveLength(1);
  });

  it("also guards against a second, different webhook event recording the same estimate's deposit twice", async () => {
    // Simulates something re-triggering recordEstimateDepositPayment for
    // this same estimate under a genuinely different Stripe event id
    // (not just a retried delivery of the same one, which the
    // WebhookEvent table above already covers) — depositPaidAt being
    // already set is what actually stops a second Invoice here.
    const event = fakeEvent("evt_estimate_deposit_1_retry", "checkout.session.async_payment_succeeded", {
      payment_intent: "pi_fake_estimate_deposit_second",
      metadata: { estimateId },
    });

    await processStripeWebhookEvent(event);

    const invoices = await prisma.invoice.findMany({ where: { customerId } });
    expect(invoices).toHaveLength(1);
  });
});

describe("convertEstimateToAgreements — applying an already-collected deposit", () => {
  it("creates a Deposit on the resulting agreement instead of leaving it to be charged again at signing, for a single-agreement conversion", async () => {
    // convertEstimateToAgreements only accepts an APPROVED estimate with
    // at least one line item — this fixture was only ever SENT (the
    // earlier describe block above tests the deposit *payment*, not
    // approval), so bring it to the state a real approved-and-paid
    // estimate would actually be in before converting it, same as
    // approveEstimate would.
    await prisma.estimateLineItem.create({
      data: {
        estimateId,
        description: "Washer/dryer set",
        monthlyPriceCents: 6000,
      },
    });
    await prisma.estimate.update({
      where: { id: estimateId },
      data: {
        status: "APPROVED",
        respondedAt: new Date(),
        approverName: "Test Approver",
        approverEmail: "approver@example.test",
      },
    });

    const agreementIds = await convertEstimateToAgreements(staffUserId, estimateId, {
      mode: "single",
      serviceAddressId,
    });
    expect(agreementIds).toHaveLength(1);

    const deposit = await prisma.deposit.findFirst({ where: { agreementId: agreementIds[0] } });
    expect(deposit).not.toBeNull();
    expect(deposit!.amountCents).toBe(20000);

    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementIds[0] },
    });
    // Still the true, correct amount to show on the agreement — only
    // *charging* it again at signing is what's skipped (see
    // createCheckoutSessionForAgreement in src/domains/billing/checkout.ts).
    expect(agreement.depositCents).toBe(20000);
    // Approval already wrote the cash Payment. Conversion's Deposit is a
    // liability mirror and must not add another positive export movement.
    const rows = (await getAccountingTransactions()).filter(row => row.customerName === "Estimate Deposit Customer");
    expect(rows.filter(row => row.type === "Payment")).toHaveLength(1);
    expect(rows.map(row => row.amountCents).reduce((sum, amount) => sum + amount, 0)).toBe(20000);
    expect(rows).toHaveLength(1);
  });
});

