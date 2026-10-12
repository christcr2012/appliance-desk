import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";
import { createCheckoutSessionForAgreement } from "@/domains/billing/checkout";
import { getReviewedSigningPayment } from "@/domains/billing/signing-payment-readiness";
import { processSigningCheckoutEvent } from "@/domains/billing/signing-payment-settlement";
import type { WebhookEvidence } from "@/domains/billing/webhook-evidence";
import { createSigningTestCheckout } from "@/domains/billing/signing-payment-checkout";
import { __setStripeClientForTests } from "@/lib/stripe";
import type Stripe from "stripe";
import { signAgreementAction } from "@/app/sign/[id]/actions";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { signedPaymentObligation } from "@/domains/billing/signing-payment-obligation";
import { getFrozenSigningOrderInTx } from "@/domains/billing/signing-frozen-verify";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(async () => false) }));
import { getSignatureRecordForSigning, sendForSignature, signAgreement } from "@/domains/agreements";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

describe.skipIf(!enabled)("W-22C6B signed offer is bound to frozen cents (isolated DB)", () => {
  const tag = randomUUID().replaceAll("-", "");
  let ownerId: string, userId: string, customerId: string, addressId: string;
  let agreementId: string, signatureId: string, positiveAgreementId: string | undefined;
  let cleanTax: (() => Promise<void>) | null = null;
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    userId = (await prisma.user.create({ data: {
      role: "CUSTOMER", email: `sign-guard-${tag}@test.invalid`, emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: `SIGNGUARD-${tag}`,
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "8 Signing Proof St", city: "Greeley", zip: "80631",
    } })).id;
    const ctx = await seedTaxReadyContext(addressId);
    cleanTax = ctx.cleanup;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
    await prisma.rentalLine.create({ data: {
      agreementId, label: "Washer", monthlyPriceCents: 3500, listPriceCents: 3500,
    } });
  });
  afterAll(async () => {
    if (!agreementId) return;
    await prisma.documentArtifact.deleteMany({ where: { customerId } });
    await prisma.signingPaymentAttempt.deleteMany({
      where: { agreementId: { in: [agreementId, ...(positiveAgreementId ? [positiveAgreementId] : [])] } },
    });
    if (!process.env.DATABASE_URL?.includes("/appliance_desk_test")) throw new Error("Disposable database required for W-22 fixture cleanup");
    await prisma.$executeRaw`TRUNCATE TABLE "SigningDownPaymentCredit"`;
    await prisma.agreementSigningPayment.deleteMany({
      where: { agreementId: { in: [agreementId, ...(positiveAgreementId ? [positiveAgreementId] : [])] } },
    });
    await prisma.receipt.deleteMany({ where: { customerId } });
    if (positiveAgreementId) {
      await prisma.auditLog.deleteMany({ where: { entityId: positiveAgreementId } });
      await prisma.signatureRecord.deleteMany({ where: { agreementId: positiveAgreementId } });
      await prisma.agreementSigningCharge.deleteMany({ where: { agreementId: positiveAgreementId } });
      await prisma.rentalLine.deleteMany({ where: { agreementId: positiveAgreementId } });
      await prisma.rentalAgreement.deleteMany({ where: { id: positiveAgreementId } });
    }
    await prisma.auditLog.deleteMany({ where: { entityId: agreementId } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId } });
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await cleanTax?.();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  it("refuses to issue a signing link with no reviewed frozen amounts", async () => {
    await expect(sendForSignature(ownerId, agreementId)).rejects.toThrow(/Complete matching frozen/);
    expect(await prisma.signatureRecord.count({ where: { agreementId } })).toBe(0);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).status).toBe("DRAFT");
  });

  it("freezes a zero-fee agreement and binds the link to exactly those cents", async () => {
    await prisma.agreementSigningCharge.create({ data: {
      agreementId, serviceAddressId: addressId, version: 1,
      machineCount: 1, firstMonthRentCents: 3500, setupFeeCents: 0,
      downPaymentCents: 0, signingSubtotalCents: 0,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: new Date(),
      sourceFingerprint: "a".repeat(64), createdByUserId: ownerId,
    } });
    const frozen = await freezeReviewedSigningOrder(ownerId, agreementId);
    expect(frozen.status).toBe("FROZEN");
    const signature = await sendForSignature(ownerId, agreementId);
    signatureId = signature.id;
    expect(signature.signingOrderFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(signature.signingAllInCents).toBe(0);
    expect(signature.signingEvidenceVersion).toBe(1);
    const offered = await getSignatureRecordForSigning(signatureId);
    expect(offered?.frozenSigningLine).toMatchObject({ agreementId, allInCents: 0 });
  });

  it("rejects tampering after link delivery, without accepting a signature", async () => {
    const original = await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } });
    await prisma.signatureRecord.update({ where: { id: signatureId },
      data: { signingOrderFingerprint: "b".repeat(64) } });
    expect(await getSignatureRecordForSigning(signatureId)).toBeNull();
    await expect(signAgreement(signatureId, {
      signerName: "Verified Customer", signerEmail: "signed@example.test", ipAddress: null,
    })).rejects.toThrow(/no longer valid/);
    expect((await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } })).signedAt).toBeNull();
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).status)
      .toBe("AWAITING_SIGNATURE");
    await prisma.signatureRecord.update({ where: { id: signatureId },
      data: { signingOrderFingerprint: original.signingOrderFingerprint } });
  });

  it("never falls back to a legacy charge for a real frozen customer-accepted agreement", async () => {
    const before = await prisma.providerOperation.count({ where: { subjectId: agreementId } });
    await expect(createCheckoutSessionForAgreement(agreementId)).rejects.toThrow(/legacy checkout is blocked/);
    expect(await prisma.providerOperation.count({ where: { subjectId: agreementId } })).toBe(before);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0);
  });

  it("does not prepare an unsigned or mismatched signing payment", async () => {
    await expect(getReviewedSigningPayment(agreementId)).rejects.toThrow(/not eligible|signature is required/);
    const original = await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } });
    await prisma.signatureRecord.update({ where: { id: signatureId }, data: { signingAllInCents: 1 } });
    await expect(getReviewedSigningPayment(agreementId)).rejects.toThrow(/not eligible|signature is required/);
    await prisma.signatureRecord.update({ where: { id: signatureId }, data: {
      signingAllInCents: original.signingAllInCents,
    } });
  });

  it("rolls back the entire signature when the immutable payment obligation cannot be inserted", async () => {
    const proof = await prisma.$transaction(tx => getFrozenSigningOrderInTx(tx, agreementId));
    const line = proof.find(row => row.agreementId === agreementId)!;
    // Force a unique conflict after signatureRecord.updateMany succeeds.
    await prisma.agreementSigningPayment.create({ data: signedPaymentObligation(line, new Date()) });
    const beforeAudit = await prisma.auditLog.count({ where: {
      action: "agreement.sign", entityId: agreementId,
    } });
    try {
      await expect(signAgreement(signatureId, {
        signerName: "Customer", signerEmail: "customer@test.invalid", ipAddress: null,
      })).rejects.toThrow();
      expect((await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } })).signedAt).toBeNull();
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).status).toBe("AWAITING_SIGNATURE");
      expect(await prisma.auditLog.count({ where: { action: "agreement.sign", entityId: agreementId } })).toBe(beforeAudit);
    } finally {
      await prisma.agreementSigningPayment.delete({ where: { agreementId } });
    }
  });

  it("accepts the unchanged frozen offer using the atomic signature transition", async () => {
    // Exercise the actual public action through the real locked signature,
    // persisted frozen evidence, and payment-readiness query. Only Next's
    // request headers / test rate limiter are mocked, not Prisma or money.
    const result = await signAgreementAction(signatureId, {
      signerName: "Verified Customer", signerEmail: "signed@example.test", agreedToTerms: true,
    });
    expect(result).toMatchObject({ status: "success", agreementId,
      checkoutUrl: null, pendingSigningAmountCents: 0 });
    expect((await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } })).signedAt).not.toBeNull();
    expect(await prisma.agreementSigningPayment.findUniqueOrThrow({ where: { agreementId } })).toMatchObject({
      status: "NOT_DUE", totalCents: 0, downPaymentCents: 0,
      orderFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const verified = await getReviewedSigningPayment(agreementId);
    expect(verified).toMatchObject({ customerId, agreementId,
      plan: { agreementId, allInCents: 0, items: [], evidenceVersion: 1 },
    });
    expect(verified.signedAt).toBeInstanceOf(Date);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0);
  });

  it("returns a genuinely signed $35.00 W-22 down payment from PostgreSQL, without legacy Stripe", async () => {
    positiveAgreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
    await prisma.rentalLine.createMany({ data: Array.from({ length: 5 }, (_, i) => ({
      agreementId: positiveAgreementId!, label: `Washer ${i + 1}`,
      monthlyPriceCents: 700, listPriceCents: 700,
    })) });
    await prisma.agreementSigningCharge.create({ data: {
      agreementId: positiveAgreementId, serviceAddressId: addressId, version: 1,
      machineCount: 5, firstMonthRentCents: 3500, setupFeeCents: 0,
      downPaymentCents: 3500, signingSubtotalCents: 3500,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: new Date(),
      sourceFingerprint: "c".repeat(64), createdByUserId: ownerId,
    } });
    expect((await freezeReviewedSigningOrder(ownerId, positiveAgreementId)).status).toBe("FROZEN");
    const sig = await sendForSignature(ownerId, positiveAgreementId);
    expect(sig.signingAllInCents).toBe(3500);
    const beforeProvider = await prisma.providerOperation.count({ where: { subjectId: positiveAgreementId } });
    const signed = await signAgreementAction(sig.id, {
      signerName: "Real Customer", signerEmail: "real@example.test", agreedToTerms: true,
    });
    expect(signed).toMatchObject({ status: "success", agreementId: positiveAgreementId,
      checkoutUrl: null, pendingSigningAmountCents: 3500 });
    expect(await prisma.invoice.count({ where: { agreementId: positiveAgreementId } })).toBe(0);
    expect(await prisma.providerOperation.count({ where: { subjectId: positiveAgreementId } })).toBe(beforeProvider);
    expect(await prisma.agreementSigningPayment.findUniqueOrThrow({ where: { agreementId: positiveAgreementId } })).toMatchObject({
      status: "AWAITING_PAYMENT", totalCents: 3500, downPaymentCents: 3500,
      setupFeeCents: 0, setupTaxCents: 0,
    });
    const proof = await getReviewedSigningPayment(positiveAgreementId);
    expect(proof.plan).toMatchObject({ allInCents: 3500,
      items: [{ kind: "FIRST_MONTH_DOWN_PAYMENT", amountCents: 3500 }] });
  });

  it("reserves exactly one durable attempt, refuses incompatible methods and invented provider outcomes", async () => {
    expect(positiveAgreementId).toBeTruthy();
    const concurrent = await Promise.all(Array.from({ length: 5 },
      () => prepareSigningPaymentAttempt(positiveAgreementId!, "STRIPE_CHECKOUT")));
    expect(new Set(concurrent.map(result => result.id)).size).toBe(1);
    const first = concurrent[0]!;
    expect(first).toMatchObject({
      agreementId: positiveAgreementId, amountCents: 3500,
      method: "STRIPE_CHECKOUT", status: "PREPARED", attemptNumber: 1,
    });
    expect((await prepareSigningPaymentAttempt(positiveAgreementId!, "STRIPE_CHECKOUT")).id).toBe(first.id);
    expect(await prisma.signingPaymentAttempt.count({ where: { agreementId: positiveAgreementId } })).toBe(1);
    await expect(prepareSigningPaymentAttempt(positiveAgreementId!, "MANUAL")).rejects.toThrow(/authenticated/);
    await expect(prepareSigningPaymentAttempt(positiveAgreementId!, "MANUAL", userId))
      .rejects.toThrow(/no longer has access/);
    await expect(prepareSigningPaymentAttempt(positiveAgreementId!, "MANUAL", ownerId))
      .rejects.toThrow(/incompatible/);
    await expect(prepareSigningPaymentAttempt(agreementId, "STRIPE_CHECKOUT")).rejects.toThrow();
    await expect(prisma.signingPaymentAttempt.update({
      where: { id: first.id }, data: { amountCents: -1 },
    })).rejects.toThrow();
    await expect(prisma.signingPaymentAttempt.update({
      where: { id: first.id }, data: { status: "PAID" },
    })).rejects.toThrow();
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { agreementId: positiveAgreementId } })).toBe(0);
    expect(await prisma.agreementSigningPayment.findUniqueOrThrow({
      where: { agreementId: positiveAgreementId },
    })).toMatchObject({ status: "AWAITING_PAYMENT", totalCents: 3500 });
  });

  it("TEST Stripe Checkout is gated, exact-amount, idempotent, and never records fake settlement", async () => {
    expect(positiveAgreementId).toBeTruthy();
    const beforeReceiptCount = await prisma.receipt.count({ where: { customerId } });
    const beforeInvoiceCount = await prisma.invoice.count({ where: { agreementId: positiveAgreementId } });
    const env = {
      gate: process.env.W22_SIGNING_TEST_CHECKOUT_ENABLED,
      secret: process.env.STRIPE_SECRET_KEY,
      vercel: process.env.VERCEL_ENV,
      url: process.env.NEXT_PUBLIC_APP_URL,
    };
    let creates = 0, retrieves = 0;
    const fake: { session?: Stripe.Checkout.Session } = {};
    try {
      delete process.env.W22_SIGNING_TEST_CHECKOUT_ENABLED;
      await expect(createSigningTestCheckout(positiveAgreementId!)).rejects.toThrow(/not authorized/);
      process.env.W22_SIGNING_TEST_CHECKOUT_ENABLED = "true";
      process.env.STRIPE_SECRET_KEY = ["sk", "test", "local-only"].join("_");
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
      __setStripeClientForTests({ checkout: { sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions) => {
          creates++;
          expect(options.idempotencyKey).toMatch(/^w22-sign-[a-f0-9]{64}$/);
          expect(params.mode).toBe("payment");
          expect(params.line_items?.map(item => item.price_data?.unit_amount)).toEqual([3500]);
          expect(params.payment_intent_data?.metadata?.orderFingerprint).toMatch(/^[a-f0-9]{64}$/);
          fake.session = {
            id: "cs_test_fake_w22_" + tag, mode: "payment",
            client_reference_id: positiveAgreementId!, amount_total: 3500,
            currency: "usd", payment_status: "unpaid", status: "open",
            metadata: params.metadata, url: "https://checkout.stripe.com/c/pay/test",
          } as Stripe.Checkout.Session;
          return fake.session;
        },
        retrieve: async (id: string) => {
          retrieves++;
          expect(id).toBe(fake.session?.id);
          return fake.session!;
        },
      } } } as unknown as Stripe);
      const first = await createSigningTestCheckout(positiveAgreementId!);
      const second = await createSigningTestCheckout(positiveAgreementId!);
      expect(creates).toBe(1);
      expect(retrieves).toBe(1);
      expect(first).toMatchObject({ status: "AWAITING_CUSTOMER", checkoutUrl: "https://checkout.stripe.com/c/pay/test" });
      expect(second.sessionId).toBe(first.sessionId);
      expect(await prisma.signingPaymentAttempt.findUniqueOrThrow({
        where: { id: first.attemptId },
      })).toMatchObject({ status: "PENDING", providerObjectId: first.sessionId,
        amountCents: 3500 });
      expect(await prisma.agreementSigningPayment.findUniqueOrThrow({
        where: { agreementId: positiveAgreementId },
      })).toMatchObject({ status: "AWAITING_PAYMENT" });
      expect(await prisma.receipt.count({ where: { customerId } })).toBe(beforeReceiptCount);
      expect(await prisma.invoice.count({ where: { agreementId: positiveAgreementId } })).toBe(beforeInvoiceCount);
    } finally {
      __setStripeClientForTests(null);
      for (const [name, value] of [
        ["W22_SIGNING_TEST_CHECKOUT_ENABLED", env.gate],
        ["STRIPE_SECRET_KEY", env.secret],
        ["VERCEL_ENV", env.vercel],
        ["NEXT_PUBLIC_APP_URL", env.url],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("database rejects an invented settled status or changed obligation total", async () => {
    expect(positiveAgreementId).toBeTruthy();
    await expect(prisma.agreementSigningPayment.update({
      where: { agreementId: positiveAgreementId }, data: { status: "SETTLED" },
    })).rejects.toThrow();
    await expect(prisma.agreementSigningPayment.update({
      where: { agreementId: positiveAgreementId }, data: { totalCents: 3499 },
    })).rejects.toThrow();
    expect(await prisma.agreementSigningPayment.findUniqueOrThrow({
      where: { agreementId: positiveAgreementId },
    })).toMatchObject({status:"AWAITING_PAYMENT", totalCents:3500});
  });

  it("refuses altered proof after signing, with no payment or invoice side effects", async () => {
    const proof = await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } });
    const initial = await prisma.agreementSigningCharge.findUniqueOrThrow({ where: { agreementId } });
    const before = {
      invoices: await prisma.invoice.count({ where: { agreementId } }),
      providerOperations: await prisma.providerOperation.count({ where: { subjectId: agreementId } }),
    };
    try {
      await prisma.signatureRecord.update({ where: { id: signatureId }, data: {
        signingOrderFingerprint: "b".repeat(64),
      } });
      await expect(getReviewedSigningPayment(agreementId)).rejects.toThrow(/no longer matches/);
      await prisma.signatureRecord.update({ where: { id: signatureId }, data: {
        signingOrderFingerprint: proof.signingOrderFingerprint,
      } });
      await prisma.agreementSigningCharge.update({ where: { agreementId }, data: {
        frozenAllInCents: 1,
      } });
      await expect(getReviewedSigningPayment(agreementId)).rejects.toThrow(/frozen/i);
    } finally {
      await prisma.signatureRecord.update({ where: { id: signatureId }, data: {
        signingOrderFingerprint: proof.signingOrderFingerprint,
      } });
      await prisma.agreementSigningCharge.update({ where: { agreementId }, data: {
        frozenAllInCents: initial.frozenAllInCents,
      } });
    }
    expect(await getReviewedSigningPayment(agreementId)).toMatchObject({ customerId, agreementId });
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(before.invoices);
    expect(await prisma.providerOperation.count({ where: { subjectId: agreementId } })).toBe(before.providerOperations);
  });

  it("refuses prepaid or legacy-payable agreements even when signed", async () => {
    await prisma.rentalAgreement.update({ where: { id: agreementId }, data: {
      depositCents: 3000,
    } });
    await expect(getReviewedSigningPayment(agreementId)).rejects.toThrow(/not eligible/);
    await prisma.rentalAgreement.update({ where: { id: agreementId }, data: {
      depositCents: 0, paidInFullInAdvance: true,
    } });
    await expect(getReviewedSigningPayment(agreementId)).rejects.toThrow(/not eligible/);
    await prisma.rentalAgreement.update({ where: { id: agreementId }, data: {
      paidInFullInAdvance: false,
    } });
    expect(await getReviewedSigningPayment(agreementId)).toMatchObject({ customerId, agreementId });
  });

  it("authenticates TEST provider evidence and records exactly one immutable signing receipt on replay", async () => {
    expect(positiveAgreementId).toBeTruthy();
    const attempt = await prisma.signingPaymentAttempt.findFirstOrThrow({
      where: { agreementId: positiveAgreementId },
    });
    const order = await prisma.agreementSigningPayment.findUniqueOrThrow({
      where: { agreementId: positiveAgreementId },
    });
    const chargeId = "ch_test_signing_" + tag;
    const intentId = "pi_test_signing_" + tag;
    const session = {
      id: attempt.providerObjectId,
      livemode: false,
      mode: "payment",
      currency: "usd",
      client_reference_id: positiveAgreementId,
      amount_total: order.totalCents,
      payment_status: "paid",
      payment_intent: intentId,
      metadata: {
        agreementId: positiveAgreementId!,
        attemptId: attempt.id,
        orderFingerprint: order.orderFingerprint,
      },
    } as unknown as Stripe.Checkout.Session;
    const intent: Stripe.PaymentIntent = {
      id: intentId, livemode: false, status: "succeeded",
      amount: order.totalCents, amount_received: order.totalCents,
      currency: "usd", latest_charge: chargeId,
      metadata: {
        agreementId: positiveAgreementId!,
        attemptId: attempt.id,
        orderFingerprint: order.orderFingerprint,
      },
    } as unknown as Stripe.PaymentIntent;
    const details = { stripeChargeId: chargeId, method: "card", receivedOn: new Date("2026-10-12T19:00:00Z") };
    const evidence = {
      paymentIntentWithMethod: () => intent,
      paymentDetails: () => details,
    } as unknown as WebhookEvidence;
    const event = {
      id: "evt_test_signing_" + tag,
      type: "checkout.session.completed",
      livemode: false,
      data: { object: session },
    } as Stripe.Event;
    const run = async () => prisma.$transaction(tx =>
      processSigningCheckoutEvent(tx, evidence, event, session));

    await expect(prisma.$transaction(tx =>
      processSigningCheckoutEvent(tx, evidence, {
        ...event, livemode: true,
      }, session))).rejects.toThrow(/unapproved/);
    const badSession = { ...session, amount_total: order.totalCents - 1 } as Stripe.Checkout.Session;
    await expect(prisma.$transaction(tx =>
      processSigningCheckoutEvent(tx, evidence, event, badSession))).rejects.toThrow(/does not match/);
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(0);
    const originalAmount = intent.amount_received;
    try {
      intent.amount_received = order.totalCents - 1;
      await expect(run()).rejects.toThrow(/not a verified/);
      expect(await prisma.receipt.count({ where: { customerId } })).toBe(0);
    } finally {
      intent.amount_received = originalAmount;
    }
    expect(await run()).toBe(true);
    const settled = await prisma.agreementSigningPayment.findUniqueOrThrow({
      where: { agreementId: positiveAgreementId },
    });
    expect(settled).toMatchObject({
      status: "SETTLED", totalCents: 3500, settledAt: details.receivedOn,
    });
    expect(settled.receiptId).toBeTruthy();
    expect(await prisma.receipt.findUniqueOrThrow({ where: { id: settled.receiptId! } }))
      .toMatchObject({
        source: "STRIPE", amountCents: 3500, stripeChargeId: chargeId,
        customerId,
      });
    expect(await prisma.signingPaymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    })).toMatchObject({ status: "SUCCEEDED", stripePaymentIntentId: intentId });
    expect(await run()).toBe(true);
    expect(await Promise.all([run(), run()])).toEqual([true, true]);
    const entitlement = await prisma.signingDownPaymentCredit.findUniqueOrThrow({
      where: { agreementId: positiveAgreementId },
    });
    expect(entitlement).toMatchObject({
      agreementId: positiveAgreementId,
      receiptId: settled.receiptId,
      orderFingerprint: order.orderFingerprint,
      amountCents: order.downPaymentCents,
    });
    expect(await prisma.signingDownPaymentCredit.count({
      where: { agreementId: positiveAgreementId },
    })).toBe(1);
    await expect(prisma.$executeRaw`
      UPDATE "SigningDownPaymentCredit" SET "amountCents" = 1
      WHERE "agreementId" = ${positiveAgreementId}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      INSERT INTO "SigningDownPaymentCredit" (
        "agreementId", "receiptId", "orderFingerprint", "amountCents"
      ) VALUES (
        ${positiveAgreementId}, ${settled.receiptId}, ${order.orderFingerprint},
        ${order.downPaymentCents + 1}
      )
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      UPDATE "AgreementSigningPayment" SET "downPaymentCents" = 1
      WHERE "agreementId" = ${positiveAgreementId}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      UPDATE "Receipt" SET "amountCents" = 1 WHERE "id" = ${settled.receiptId}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "AgreementSigningPayment" SET "signedAt" = NOW() WHERE "agreementId" = ${positiveAgreementId}`).rejects.toThrow();
    await expect(prisma.$executeRaw`
      INSERT INTO "SigningDownPaymentCredit" (
        "agreementId", "receiptId", "orderFingerprint", "amountCents"
      ) VALUES (${agreementId}, ${settled.receiptId}, ${order.orderFingerprint}, 3500)
    `).rejects.toThrow();
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(1);
    expect(await prisma.invoice.count({ where: { agreementId: positiveAgreementId } })).toBe(0);
    expect(await prisma.customerCredit.count({ where: { customerId } })).toBe(0);
    await expect(prisma.$transaction(tx => processSigningCheckoutEvent(
      tx, {
        paymentIntentWithMethod: () => ({ ...intent, id: "pi_test_other" }),
        paymentDetails: () => details,
      } as unknown as WebhookEvidence, event, session,
    ))).rejects.toThrow(/not a verified/);
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(1);
  });

});
