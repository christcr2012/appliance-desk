import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { freezeReviewedSigningOrder } from "@/domains/billing/signing-charge-freeze";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

describe.skipIf(!enabled)("W-22C5 private freeze (disposable PostgreSQL)", () => {
  const tag = randomUUID().replaceAll("-", "");
  let ownerId: string, staffId: string, userId: string, customerId: string;
  let addressId: string, agreementId: string, lineId: string;
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    staffId = (await prisma.user.create({ data: {
      role: "STAFF", email: `frozen-staff-${tag}@test.invalid`, emailVerified: true,
    } })).id;
    userId = (await prisma.user.create({ data: {
      role: "CUSTOMER", email: `frozen-customer-${tag}@test.invalid`, emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: `FROZEN-${tag}`,
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "67 Frozen St", city: "Greeley", zip: "80631",
    } })).id;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
    lineId = (await prisma.rentalLine.create({ data: {
      agreementId, label: "Dryer", monthlyPriceCents: 3500, listPriceCents: 3500,
    } })).id;
  });
  afterAll(async () => {
    if (!agreementId) return;
    await prisma.auditLog.deleteMany({ where: {
      action: "signing_charge.freeze_reviewed_order", entityId: agreementId,
    } });
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId } });
    await prisma.rentalLine.delete({ where: { id: lineId } });
    await prisma.rentalAgreement.delete({ where: { id: agreementId } });
    await prisma.serviceAddress.delete({ where: { id: addressId } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, staffId] } } });
  });
  it("revoked/non-owner actors cannot freeze even a draft", async () => {
    await expect(freezeReviewedSigningOrder(staffId, agreementId)).rejects.toThrow();
    await expect(freezeReviewedSigningOrder(userId, agreementId)).rejects.toThrow();
  });
  it("missing prepared charges cannot leave half-frozen rows or audits", async () => {
    await expect(freezeReviewedSigningOrder(ownerId, agreementId)).rejects.toThrow(/reviewed signing charges/);
    expect(await prisma.agreementSigningCharge.count({ where: { agreementId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: {
      action: "signing_charge.freeze_reviewed_order", entityId: agreementId,
    } })).toBe(0);
  });
  it("freezes only confirmed zero-fee evidence and replays without writes", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    await prisma.agreementSigningCharge.create({ data: {
      agreementId, serviceAddressId: addressId,
      machineCount: 1, firstMonthRentCents: 3500,
      setupFeeCents: 4500, downPaymentCents: 0, signingSubtotalCents: 4500,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: new Date(),
      sourceFingerprint: "a".repeat(64), createdByUserId: owner.id,
    } });
    await expect(freezeReviewedSigningOrder(ownerId, agreementId))
      .rejects.toThrow(/CPA-confirmed tax/);
    expect((await prisma.agreementSigningCharge.findUniqueOrThrow({ where: { agreementId } })).frozenAt)
      .toBeNull();
    await prisma.agreementSigningCharge.update({ where: { agreementId }, data: {
      setupFeeCents: 0, signingSubtotalCents: 0,
    } });
    const result = await freezeReviewedSigningOrder(ownerId, agreementId);
    expect(result.status).toBe("FROZEN");
    const stored = await prisma.agreementSigningCharge.findUniqueOrThrow({ where: { agreementId } });
    expect(stored.frozenAt).not.toBeNull();
    expect(stored.frozenAllInCents).toBe(0);
    expect(stored.frozenChargeEvidence).toMatchObject({ agreementId, allInCents: 0 });
    expect((await freezeReviewedSigningOrder(ownerId, agreementId)).status).toBe("ALREADY_FROZEN");
    expect(await prisma.auditLog.count({ where: {
      action: "signing_charge.freeze_reviewed_order", entityId: agreementId,
    } })).toBe(1);
  });
});
