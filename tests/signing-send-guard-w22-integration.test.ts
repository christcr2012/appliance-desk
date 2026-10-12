import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";
import { createCheckoutSessionForAgreement } from "@/domains/billing/checkout";
import { getReviewedSigningPayment } from "@/domains/billing/signing-payment-readiness";
import { getSignatureRecordForSigning, sendForSignature, signAgreement } from "@/domains/agreements";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

describe.skipIf(!enabled)("W-22C6B signed offer is bound to frozen cents (isolated DB)", () => {
  const tag = randomUUID().replaceAll("-", "");
  let ownerId: string, userId: string, customerId: string, addressId: string;
  let agreementId: string, signatureId: string;
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
    const before = await prisma.providerOperation.count();
    await expect(createCheckoutSessionForAgreement(agreementId)).rejects.toThrow(/legacy checkout is blocked/);
    expect(await prisma.providerOperation.count()).toBe(before);
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

  it("accepts the unchanged frozen offer using the atomic signature transition", async () => {
    await signAgreement(signatureId, {
      signerName: "Verified Customer", signerEmail: "signed@example.test", ipAddress: null,
    });
    expect((await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } })).signedAt).not.toBeNull();
    const verified = await getReviewedSigningPayment(agreementId);
    expect(verified).toMatchObject({ customerId, agreementId,
      plan: { agreementId, allInCents: 0, items: [], evidenceVersion: 1 },
    });
    expect(verified.signedAt).toBeInstanceOf(Date);
  });

  it("refuses altered proof after signing, with no payment or invoice side effects", async () => {
    const proof = await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signatureId } });
    const initial = await prisma.agreementSigningCharge.findUniqueOrThrow({ where: { agreementId } });
    const before = {
      invoices: await prisma.invoice.count({ where: { agreementId } }),
      providerOperations: await prisma.providerOperation.count(),
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
    expect(await prisma.providerOperation.count()).toBe(before.providerOperations);
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
});
