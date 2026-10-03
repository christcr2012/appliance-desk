import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessSettingsSchema } from "@/domains/settings/form-schema";
import { parseTaxRatePercent } from "@/domains/billing/tax";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
import { createDraftAgreement } from "@/domains/agreements";

describe("tax rate typed by the owner", () => {
  const field = businessSettingsSchema.shape.taxRatePercentText;
  it("accepts ordinary percentages with up to three decimals", () => {
    for (const ok of ["0", "8", "7.3", "7.375", " 7.375% "]) {
      expect(field.safeParse(ok).success, ok).toBe(true);
    }
  });
  it("refuses extra precision, text, negatives and rates over 100%", () => {
    for (const bad of ["", "7.3751", "abc", "-1", "101", "7,5"]) {
      expect(field.safeParse(bad).success, bad).toBe(false);
    }
  });
  it("stores 7.375% exactly as 7375", () => {
    expect(parseTaxRatePercent("7.375")).toBe(7375);
  });
});

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("exact tax rate round trip on a real database", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `tax-owner-${tag}`;
  const customerUserId = `tax-cust-user-${tag}`;
  const customerId = `tax-customer-${tag}`;
  const addressId = `tax-address-${tag}`;
  let originalRate = 0;
  let agreementId = "";

  beforeAll(async () => {
    originalRate = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).taxRateMilliPercent;
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "Tax Owner", role: "OWNER", emailVerified: true },
        { id: customerUserId, email: `${tag}-c@example.test`, name: "Tax Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId: customerUserId, referralCode: `T${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Tax St", city: "Greeley", zip: "80631" } });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { taxRateMilliPercent: originalRate } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: agreementId }] } });
    if (agreementId) await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("saves 7.375% in settings and reads it back unchanged", async () => {
    await updateBusinessSettings(ownerId, { taxRateMilliPercent: parseTaxRatePercent("7.375") });
    const row = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.taxRateMilliPercent).toBe(7375);
  });

  it("freezes 7.375% on a new agreement", async () => {
    const agreement = await createDraftAgreement(ownerId, {
      customerId,
      serviceAddressId: addressId,
      taxRateMilliPercent: 7375,
    });
    agreementId = agreement.id;
    const row = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(row.taxRateMilliPercent).toBe(7375);
  });
});
