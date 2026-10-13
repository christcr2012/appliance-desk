import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";
import { sendForSignature } from "@/domains/agreements";
import { signAgreementAction } from "@/app/sign/[id]/actions";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { recordManualSigningPayment } from "@/domains/billing/signing-payment-manual";
import { seedTaxReadyContext } from "./helpers/tax-ready";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(async () => false) }));
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("W-22D13 exact owner-recorded signing payment (disposable DB)", () => {
  const run = randomUUID().replaceAll("-", "");
  let ownerId: string, userId: string, customerId: string, addressId: string, agreementId: string;
  let cleanupTax: (() => Promise<void>) | null = null;
  let attemptId: string;
  const payment = () => ({
    agreementId, attemptId, actingUserId: ownerId, method: "check" as const,
    reference: "CHK-" + run.slice(0, 12), receivedOn: "2026-10-12", confirmedReceived: true,
  });
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    userId = (await prisma.user.create({ data: {
      email: "w22-manual-" + run + "@test.invalid", role: "CUSTOMER", emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: "D13" + run.slice(0, 15),
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "13 Manual Receipt St", city: "Greeley", zip: "80631",
    } })).id;
    const tax = await seedTaxReadyContext(addressId);
    cleanupTax = tax.cleanup;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
    await prisma.rentalLine.createMany({ data: Array.from({ length: 5 }, (_, n) => ({
      agreementId, label: "Washer " + (n + 1), monthlyPriceCents: 700, listPriceCents: 700,
    })) });
    await prisma.agreementSigningCharge.create({ data: {
      agreementId, serviceAddressId: addressId, version: 1, machineCount: 5,
      firstMonthRentCents: 3500, setupFeeCents: 0, downPaymentCents: 3500,
      signingSubtotalCents: 3500, setupFeeTaxTreatment: "UNDECIDED",
      settingsUpdatedAt: new Date(), sourceFingerprint: "c".repeat(64), createdByUserId: ownerId,
    } });
    expect((await freezeReviewedSigningOrder(ownerId, agreementId)).status).toBe("FROZEN");
    const signature = await sendForSignature(ownerId, agreementId);
    const signed = await signAgreementAction(signature.id, {
      signerName: "Manual Payment Customer", signerEmail: "manual@example.test", agreedToTerms: true,
    });
    expect(signed).toMatchObject({ status: "success", pendingSigningAmountCents: 3500 });
  });
  afterAll(async () => {
    if (!agreementId) return;
    // The immutable entitlement's trigger intentionally blocks ordinary DELETE;
    // only the disposable isolated DB can clear its tables as existing W-22 suites do.
    if (process.env.DATABASE_URL?.includes("/appliance_desk_test")) {
      await prisma.$executeRaw`TRUNCATE TABLE "SigningFirstInvoiceApplication", "SigningDownPaymentCredit"`;
    }
    await prisma.signingPaymentAttempt.deleteMany({ where: { agreementId } });
    await prisma.agreementSigningPayment.deleteMany({ where: { agreementId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { entityId: agreementId } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId } });
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await cleanupTax?.();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  it("requires a real OWNER/ADMIN to reserve the MANUAL attempt", async () => {
    await expect(prepareSigningPaymentAttempt(agreementId, "MANUAL", userId))
      .rejects.toThrow();
    const attempt = await prepareSigningPaymentAttempt(agreementId, "MANUAL", ownerId);
    expect(attempt).toMatchObject({ method: "MANUAL", status: "PREPARED", amountCents: 3500 });
    attemptId = attempt.id;
    expect((await prepareSigningPaymentAttempt(agreementId, "MANUAL", ownerId)).id).toBe(attemptId);
    await expect(prepareSigningPaymentAttempt(agreementId, "STRIPE_CHECKOUT")).rejects.toThrow();
  });
  it("rejects missing confirmation, invalid method, forged actor and foreign attempt without receiving money", async () => {
    await expect(recordManualSigningPayment({ ...payment(), confirmedReceived: false })).rejects.toThrow();
    await expect(recordManualSigningPayment({ ...payment(), method: "card" as never })).rejects.toThrow();
    await expect(recordManualSigningPayment({ ...payment(), actingUserId: userId })).rejects.toThrow();
    await expect(recordManualSigningPayment({ ...payment(), attemptId: "foreign" })).rejects.toThrow();
    await expect(recordManualSigningPayment({ ...payment(), receivedOn: "2026-13-45" })).rejects.toThrow();
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(0);
    expect(await prisma.signingDownPaymentCredit.count({ where: { agreementId } })).toBe(0);
    expect((await prisma.agreementSigningPayment.findUniqueOrThrow({ where: { agreementId } })).status).toBe("AWAITING_PAYMENT");
  });
  it("serializes concurrent identical confirmations into exactly one audited cash receipt and one agreement credit", async () => {
    const results = await Promise.all([
      recordManualSigningPayment(payment()), recordManualSigningPayment(payment()),
    ]);
    expect(new Set(results.map(r => r.receiptId)).size).toBe(1);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
    expect(results[0].amountCents).toBe(3500);
    expect(await prisma.receipt.count({ where: { customerId, source: "MANUAL" } })).toBe(1);
    expect(await prisma.signingDownPaymentCredit.count({ where: { agreementId } })).toBe(1);
    expect(await prisma.customerCredit.count({ where: { customerId } })).toBe(0);
    expect(await prisma.payment.count({ where: { invoice: { agreementId } } })).toBe(0);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: {
      entityType: "RentalAgreement", entityId: agreementId, action: "billing.signing_manual_payment",
    } })).toBe(1);
    expect(await prisma.agreementSigningPayment.findUniqueOrThrow({ where: { agreementId } }))
      .toMatchObject({ status: "SETTLED", receiptId: results[0].receiptId, downPaymentCents: 3500 });
  });
  it("never creates a second receipt or changes recorded reference, actor or method on replay", async () => {
    const replay = await recordManualSigningPayment(payment());
    expect(replay.replayed).toBe(true);
    await expect(recordManualSigningPayment({ ...payment(), reference: "DIFFERENT" })).rejects.toThrow();
    await expect(recordManualSigningPayment({ ...payment(), method: "cash" })).rejects.toThrow();
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(1);
    expect(await prisma.signingPaymentAttempt.count({ where: { agreementId, status: "SUCCEEDED" } })).toBe(1);
  });
});
