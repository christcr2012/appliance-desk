import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveSigningSetupFeeOverride } from "@/domains/billing/signing-setup-fee-override";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("W-22FIN owner fee exceptions: isolated SQL, tenant and freeze integrity", () => {
  const marker = randomUUID().replaceAll("-", "");
  let owner = "";
  let staff = "";
  let customerUser = "";
  let customerId = "";
  let addressId = "";
  let estimateId = "";
  let ids: string[] = [];
  const feeReason = "Owner waives location setup for this repeat customer";
  beforeAll(async () => {
    const person = await prisma.user.create({ data: {
      email: "fee-owner-" + marker + "@example.test", role: "OWNER", name: "Test owner",
      passwordHash: "not-a-real-login",
    } });
    const staffPerson = await prisma.user.create({ data: {
      email: "fee-staff-" + marker + "@example.test", role: "STAFF",
      passwordHash: "not-a-real-login",
    } });
    const customerPerson = await prisma.user.create({ data: {
      email: "fee-customer-" + marker + "@example.test", role: "CUSTOMER",
      passwordHash: "not-a-real-login",
    } });
    owner = person.id; staff = staffPerson.id; customerUser = customerPerson.id;
    const customer = await prisma.customer.create({ data: {
      userId: customerUser, referralCode: marker.slice(0, 25),
    } });
    customerId = customer.id;
    const address = await prisma.serviceAddress.create({ data: {
      customerId, line1: "123 Test Appliance Drive", city: "Greeley", zip: "80631", state: "CO",
    } });
    addressId = address.id;
    const estimate = await prisma.estimate.create({ data: {
      customerId, createdByUserId: owner, title: "Isolated owner fee override",
    } });
    estimateId = estimate.id;
    const first = await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId, sourceEstimateId: estimateId,
    } });
    const second = await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId, sourceEstimateId: estimateId,
    } });
    ids = [first.id, second.id].sort();
    for (const [i, agreementId] of ids.entries()) {
      await prisma.rentalLine.create({ data: {
        agreementId, label: "fixture appliance " + i, monthlyPriceCents: 4000,
      } });
    }
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: {
      userId: { in: [owner, staff] }, entityType: "RentalAgreement",
    } });
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.signingSetupFeeOverride.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    if (estimateId) await prisma.estimate.delete({ where: { id: estimateId } });
    if (addressId) await prisma.serviceAddress.delete({ where: { id: addressId } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, customerUser] } } });
  });
  it("rejects staff, unrelated address and missing reason without writes", async () => {
    await expect(saveSigningSetupFeeOverride(staff, ids[1], addressId, 0, feeReason)).rejects.toThrow();
    await expect(saveSigningSetupFeeOverride(owner, ids[1], "different-address", 0, feeReason)).rejects.toThrow(/location/);
    await expect(saveSigningSetupFeeOverride(owner, ids[1], addressId, 0, "")).rejects.toThrow(/reason/);
    expect(await prisma.signingSetupFeeOverride.count({ where: { agreementId: { in: ids } } })).toBe(0);
  });
  it("records one canonical waiver and clears stale prepared sibling charges", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    await prisma.agreementSigningCharge.create({ data: {
      agreementId: ids[1], serviceAddressId: addressId, sourceEstimateId: estimateId,
      machineCount: 1, firstMonthRentCents: 4000, setupFeeCents: 4500,
      downPaymentCents: 0, signingSubtotalCents: 4500,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: settings.updatedAt,
      sourceFingerprint: createHash("sha256").update("fixture-prefreeze-" + marker).digest("hex"), createdByUserId: owner,
    } });
    await saveSigningSetupFeeOverride(owner, ids[1], addressId, 0, feeReason);
    const rows = await prisma.signingSetupFeeOverride.findMany({
      where: { agreementId: { in: ids } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agreementId: ids[0], setupFeeCents: 0, reason: feeReason,
      authorizedByUserId: owner });
    expect(await prisma.agreementSigningCharge.count({ where: { agreementId: { in: ids } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "agreement.signing_setup_fee_override",
      entityId: ids[0], userId: owner } })).toBe(1);
    await saveSigningSetupFeeOverride(owner, ids[0], addressId, 0, feeReason);
    expect(await prisma.auditLog.count({ where: { action: "agreement.signing_setup_fee_override",
      entityId: ids[0], userId: owner } })).toBe(1);
  });
  it("forbids repricing a frozen sibling then safely restores the default when draft", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    await prisma.agreementSigningCharge.create({ data: {
      agreementId: ids[1], serviceAddressId: addressId, sourceEstimateId: estimateId,
      machineCount: 1, firstMonthRentCents: 4000, setupFeeCents: 0,
      downPaymentCents: 0, signingSubtotalCents: 0,
      setupFeeTaxTreatment: "UNDECIDED", settingsUpdatedAt: settings.updatedAt,
      sourceFingerprint: createHash("sha256").update("frozen-fixture-" + marker).digest("hex"), createdByUserId: owner,
      frozenAt: new Date(),
    } });
    await expect(saveSigningSetupFeeOverride(owner, ids[1], addressId, 2500,
      "Owner negotiated partial fee waiver")).rejects.toThrow(/frozen/);
    expect((await prisma.signingSetupFeeOverride.findUnique({ where: { agreementId: ids[0] } }))?.setupFeeCents).toBe(0);
    await prisma.agreementSigningCharge.delete({ where: { agreementId: ids[1] } });
    await saveSigningSetupFeeOverride(owner, ids[1], addressId, null, "");
    expect(await prisma.signingSetupFeeOverride.count({ where: { agreementId: { in: ids } } })).toBe(0);
  });
});
