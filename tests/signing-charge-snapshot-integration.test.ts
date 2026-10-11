import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { prepareDraftSigningChargeSnapshots } from "@/domains/billing/signing-charge-snapshot";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

describe.skipIf(!enabled)("W-22B charge snapshots on isolated PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "");
  let ownerId: string, staffId: string, customerUserId: string, customerId: string;
  let addressId: string, agreementId: string, lineId: string;
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const user = await prisma.user.create({ data: {
      role: "CUSTOMER", email: `w22b-${tag}@test.invalid`, emailVerified: true,
    } });
    customerUserId = user.id;
    staffId = (await prisma.user.create({ data: {
      role: "STAFF", email: `w22b-staff-${tag}@test.invalid`, emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId: customerUserId, referralCode: `W22B-${tag}`, isBusiness: true,
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "11 Snapshot St", city: "Greeley", zip: "80631",
    } })).id;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId,
    } })).id;
    lineId = (await prisma.rentalLine.create({ data: {
      agreementId, label: "Washer", monthlyPriceCents: 3500, listPriceCents: 3500,
    } })).id;
  });
  afterAll(async () => {
    if (!agreementId) return;
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId } });
    await prisma.auditLog.deleteMany({ where: {
      action: "agreement.signing_charges_prepared", entityId: agreementId,
    } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.delete({ where: { id: agreementId } });
    await prisma.serviceAddress.delete({ where: { id: addressId } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [customerUserId, staffId] } } });
  });

  it("refuses staff actor with no snapshot or audit mutation", async () => {
    await expect(prepareDraftSigningChargeSnapshots(staffId, agreementId))
      .rejects.toThrow(/no longer has access/i);
    expect(await prisma.agreementSigningCharge.count({ where: { agreementId } })).toBe(0);
  });

  it("persists attributed cents exactly once under concurrent preparation", async () => {
    const attempts = await Promise.allSettled([
      prepareDraftSigningChargeSnapshots(ownerId, agreementId),
      prepareDraftSigningChargeSnapshots(ownerId, agreementId),
    ]);
    expect(attempts.some((item) => item.status === "fulfilled")).toBe(true);
    const rows = await prisma.agreementSigningCharge.findMany({ where: { agreementId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1, setupFeeCents: 4500, downPaymentCents: 3500,
      signingSubtotalCents: 8000, firstMonthRentCents: 3500,
      setupFeeTaxTreatment: "UNDECIDED",
    });
    const afterCount = await prisma.auditLog.count({ where: {
      action: "agreement.signing_charges_prepared", entityId: agreementId,
    } });
    expect(afterCount).toBe(1);
    await prepareDraftSigningChargeSnapshots(ownerId, agreementId);
    expect(await prisma.auditLog.count({ where: {
      action: "agreement.signing_charges_prepared", entityId: agreementId,
    } })).toBe(1);
  });


  it("allocates one fee per address across the same converted estimate without spilling first-month credit", async () => {
    const estimate = await prisma.estimate.create({ data: {
      customerId, title: "W-22B two-address bulk order", createdByUserId: ownerId,
    } });
    const address2 = await prisma.serviceAddress.create({ data: {
      customerId, line1: "12 Snapshot St", city: "Greeley", zip: "80631",
    } });
    const agreements: string[] = [];
    try {
      for (const [address, cents] of [[addressId, 3500], [address2.id, 6000]] as const) {
        const a = await prisma.rentalAgreement.create({ data: {
          customerId, serviceAddressId: address, sourceEstimateId: estimate.id,
        } });
        agreements.push(a.id);
        await prisma.rentalLine.create({ data: {
          agreementId: a.id, label: "Appliance", monthlyPriceCents: cents, listPriceCents: cents,
        } });
      }
      const result = await prepareDraftSigningChargeSnapshots(ownerId, agreements[0]!);
      expect(result.snapshots).toHaveLength(2);
      expect(result.snapshots.reduce((n, row) => n + row.setupFeeCents, 0)).toBe(9000);
      expect(result.snapshots.reduce((n, row) => n + row.downPaymentCents, 0)).toBe(9500);
      expect(result.snapshots.map((row) => row.downPaymentCents).sort()).toEqual([3500, 6000]);
      const replay = await prepareDraftSigningChargeSnapshots(ownerId, agreements[1]!);
      expect(replay.snapshots.map((row) => row.id).sort())
        .toEqual(result.snapshots.map((row) => row.id).sort());

      // If the second agreement becomes frozen while the first requires a
      // revision, the first update and its audit must roll back atomically.
      const [firstId, lastId] = [...agreements].sort();
      const before = await prisma.agreementSigningCharge.findUniqueOrThrow({
        where: { agreementId: firstId },
      });
      const auditsBefore = await prisma.auditLog.count({
        where: { action: "agreement.signing_charges_prepared", entityId: { in: agreements } },
      });
      await prisma.agreementSigningCharge.update({
        where: { agreementId: lastId }, data: { frozenAt: new Date() },
      });
      await prisma.rentalLine.updateMany({
        where: { agreementId: firstId }, data: { monthlyPriceCents: 3700 },
      });
      await expect(prepareDraftSigningChargeSnapshots(ownerId, firstId!))
        .rejects.toThrow(/frozen signing charges/i);
      const after = await prisma.agreementSigningCharge.findUniqueOrThrow({
        where: { agreementId: firstId },
      });
      expect(after.version).toBe(before.version);
      expect(after.sourceFingerprint).toBe(before.sourceFingerprint);
      expect(await prisma.auditLog.count({
        where: { action: "agreement.signing_charges_prepared", entityId: { in: agreements } },
      })).toBe(auditsBefore);
    } finally {
      await prisma.agreementSigningCharge.deleteMany({ where: { agreementId: { in: agreements } } });
      await prisma.auditLog.deleteMany({ where: {
        action: "agreement.signing_charges_prepared", entityId: { in: agreements },
      } });
      await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreements } } });
      await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreements } } });
      await prisma.serviceAddress.delete({ where: { id: address2.id } });
      await prisma.estimate.delete({ where: { id: estimate.id } });
    }
  });

  it("revisions track draft repricing, but frozen rows never change", async () => {
    await prisma.rentalLine.update({ where: { id: lineId },
      data: { monthlyPriceCents: 3600 } });
    const updated = await prepareDraftSigningChargeSnapshots(ownerId, agreementId);
    expect(updated.snapshots).toHaveLength(1);
    expect(updated.snapshots[0]).toMatchObject({
      version: 2, downPaymentCents: 3600, signingSubtotalCents: 8100,
    });
    await prisma.agreementSigningCharge.update({ where: { agreementId },
      data: { frozenAt: new Date() } });
    await prisma.rentalLine.update({ where: { id: lineId },
      data: { monthlyPriceCents: 3700 } });
    await expect(prepareDraftSigningChargeSnapshots(ownerId, agreementId))
      .rejects.toThrow(/frozen signing charges/i);
    expect(await prisma.agreementSigningCharge.findUniqueOrThrow({
      where: { agreementId }, select: { version: true, downPaymentCents: true },
    })).toEqual({ version: 2, downPaymentCents: 3600 });
  });
});
