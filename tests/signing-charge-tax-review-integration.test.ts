import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDraftSigningTaxReviewInTx } from "@/domains/billing/signing-charge-tax-review";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("W-22C3 private signing tax review (disposable database)", () => {
  const tag = randomUUID().replaceAll("-", "");
  let userId: string, customerId: string, addressId: string, agreementId: string;
  const now = new Date("2026-10-11T12:00:00.000Z");
  const review = () => prisma.$transaction((tx) => getDraftSigningTaxReviewInTx(tx, agreementId, now));

  beforeAll(async () => {
    const user = await prisma.user.create({ data: {
      role: "CUSTOMER", email: `w22c3-${tag}@test.invalid`, emailVerified: true,
    } });
    userId = user.id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: `W22C3-${tag}`,
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "22 Draft St", city: "Greeley", zip: "80631",
    } })).id;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
  });

  afterAll(async () => {
    if (!agreementId) return;
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId: addressId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("does not invent tax totals for drafts missing prepared charges", async () => {
    const result = await review();
    expect(result).toMatchObject({ orderReady: false, rows: [] });
    expect(result.reasons.join(" ")).toMatch(/Refresh signing charges/);
  });

  it("uses stored prepared allocations and refuses a missing confirmed tax address", async () => {
    const actorId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.agreementSigningCharge.create({ data: {
      agreementId, serviceAddressId: addressId,
      version: 1, machineCount: 1, firstMonthRentCents: 3500,
      setupFeeCents: 4500, downPaymentCents: 0, signingSubtotalCents: 4500,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: now,
      sourceFingerprint: "a".repeat(64), createdByUserId: actorId,
    } });
    const result = await review();
    expect(result.orderReady).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ agreementId, version: 1,
      review: { status: "REVIEW_REQUIRED", candidateSigningTotalCents: null,
        eligibleForCollection: false } });
    expect(result.rows[0].review.reasons.join(" ")).toMatch(/IN-79|jurisdictions|Verify/i);
  });

  it("refuses a partially reviewed location with jurisdiction links", async () => {
    const state = await prisma.taxJurisdiction.findUniqueOrThrow({ where: { code: "CO" } });
    const location = await prisma.addressTaxLocation.create({ data: {
      serviceAddressId: addressId, status: "NEEDS_REVIEW", source: "MANUAL", lookedUpAt: now,
    } });
    await prisma.addressTaxJurisdiction.create({ data: {
      addressTaxLocationId: location.id, jurisdictionId: state.id,
    } });
    const result = await review();
    expect(result.orderReady).toBe(false);
    expect(result.rows[0].review).toMatchObject({ status: "REVIEW_REQUIRED",
      candidateSigningTotalCents: null, eligibleForCollection: false });
    expect(result.reasons.join(" ")).toMatch(/Verify every jurisdiction/);
  });

  it("fails closed if saved location identity no longer matches", async () => {
    await prisma.agreementSigningCharge.update({ where: { agreementId },
      data: { serviceAddressId: "wrong-location" } });
    const result = await review();
    expect(result).toMatchObject({ orderReady: false, rows: [] });
    expect(result.reasons.join(" ")).toMatch(/Refresh signing charges/);
  });
});
