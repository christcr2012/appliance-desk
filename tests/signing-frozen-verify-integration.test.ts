import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFrozenSigningOrderInTx } from "@/domains/billing/signing-frozen-verify";
import { assembleSigningOrderDraft } from "@/domains/billing/signing-order-draft-contract";
import { buildFrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("W-22C6 server-owned frozen evidence read (disposable PostgreSQL)", () => {
  const tag = randomUUID().replaceAll("-", "");
  let userId: string, ownerId: string, customerId: string, addressId: string, agreementId: string;
  const read = (id = agreementId) => prisma.$transaction(tx => getFrozenSigningOrderInTx(tx, id));
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    userId = (await prisma.user.create({ data: {
      role: "CUSTOMER", email: `frozen-read-${tag}@test.invalid`, emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: `FROZENREAD-${tag}`,
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "22 Verified St", city: "Greeley", zip: "80631",
    } })).id;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
  });
  afterAll(async () => {
    if (!agreementId) return;
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.delete({ where: { id: agreementId } });
    await prisma.serviceAddress.delete({ where: { id: addressId } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.user.delete({ where: { id: userId } });
  });
  it("does not invent signed totals from missing draft preparation", async () => {
    await expect(read()).rejects.toThrow(/Complete matching frozen/);
    await expect(read("foreign-agreement")).rejects.toThrow(/unavailable/);
  });
  it("reads only reconciled immutable server evidence and rejects a later corrupted amount", async () => {
    const sourceFingerprint = "a".repeat(64);
    const candidate = assembleSigningOrderDraft({
      agreements: [{
        agreementId, serviceAddressId: addressId, sourceFingerprint, version: 1,
        firstMonthRentCents: 3500, setupFeeCents: 0, downPaymentCents: 0,
      }],
      taxRows: [{
        agreementId, serviceAddressId: addressId, version: 1,
        review: {
          status: "CALCULATED_DRAFT", eligibleForCollection: false, reasons: [],
          setupTaxCents: 0, candidateSigningTotalCents: 0, jurisdictionLines: [],
        },
      }],
    });
    const sealed = buildFrozenSigningEvidence(candidate);
    expect(sealed).toHaveLength(1);
    await prisma.agreementSigningCharge.create({ data: {
      agreementId, serviceAddressId: addressId, version: 1,
      machineCount: 1, firstMonthRentCents: 3500,
      setupFeeCents: 0, downPaymentCents: 0, signingSubtotalCents: 0,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: new Date(),
      sourceFingerprint, createdByUserId: ownerId, frozenAt: new Date(),
      frozenOrderFingerprint: sealed[0].orderFingerprint, frozenAllInCents: 0,
      frozenSetupTaxCents: 0, frozenChargeEvidence: JSON.parse(JSON.stringify(sealed[0])),
    } });
    expect((await read())[0]).toMatchObject({ agreementId, allInCents: 0, setupTaxCents: 0 });
    await prisma.agreementSigningCharge.update({
      where: { agreementId }, data: { frozenAllInCents: 1 },
    });
    await expect(read()).rejects.toThrow(/does not match/);
  });
});
