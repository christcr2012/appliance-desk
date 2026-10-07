import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCustomerTaxExemption,
  revokeCustomerTaxExemption,
  updateCustomerTaxExemption,
} from "@/domains/tax/exemptions";
import { computeTax } from "@/domains/tax/engine";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import { prisma } from "@/lib/prisma";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T customer tax exemptions (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `tax-ex-owner-${tag}`;
  const staffId = `tax-ex-staff-${tag}`;
  const userId = `tax-ex-user-${tag}`;
  const customerId = `tax-ex-customer-${tag}`;
  const addressId = `tax-ex-address-${tag}`;
  const agreementId = `tax-ex-agreement-${tag}`;
  const taxDate = new Date("2026-10-07T18:00:00.000Z");
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;
  let exemptionId: string;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${tag}-owner@example.test`,
          name: "Tax Exemption Owner",
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: staffId,
          email: `${tag}-staff@example.test`,
          name: "Tax Exemption Staff",
          role: "STAFF",
          emailVerified: true,
        },
        {
          id: userId,
          email: `${tag}-customer@example.test`,
          name: "Tax Exemption Customer",
          role: "CUSTOMER",
          emailVerified: true,
        },
      ],
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `TX${tag.slice(0, 16)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "100 Exemption Ave",
        city: "Greeley",
        zip: "80631",
      },
    });
    taxFixture = await seedTaxReadyContext(addressId, {
      rateMilliPercent: 7_300,
    });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "DRAFT",
        termMonths: 12,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [ownerId, staffId] } },
    });
    await prisma.customerTaxExemption.deleteMany({ where: { customerId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, staffId, userId] } },
    });
  });

  async function rentalTaxCents(date = taxDate) {
    return prisma.$transaction(async (tx) => {
      const context = await getAgreementTaxContext(tx, agreementId, date);
      const result = computeTax({
        ...context,
        lines: [
          {
            key: "rent",
            kind: "RENTAL",
            amountCents: 10_000,
          },
        ],
      });
      if (!result.ok) throw new Error(result.problems.join(" "));
      return {
        totalTaxCents: result.totalTaxCents,
        exemptCents: result.lines.reduce(
          (sum, line) => sum + line.exemptCents,
          0,
        ),
      };
    });
  }

  it("lets only the owner create and edit an exemption and applies an active all-jurisdiction exemption", async () => {
    await expect(
      createCustomerTaxExemption(staffId, customerId, {
        reason: "RESALE",
        validFrom: new Date("2026-01-01T07:00:00.000Z"),
      }),
    ).rejects.toThrow(/no longer has access/i);

    const exemption = await createCustomerTaxExemption(ownerId, customerId, {
      reason: "RESALE",
      certificateNumber: "  RESALE-123  ",
      jurisdictionIds: [],
      validFrom: new Date("2026-01-01T07:00:00.000Z"),
      expiresOn: new Date("2026-12-31T07:00:00.000Z"),
      notes: "  Verified resale certificate  ",
    });
    exemptionId = exemption.id;
    expect(exemption.certificateNumber).toBe("RESALE-123");
    expect(exemption.notes).toBe("Verified resale certificate");

    expect(await rentalTaxCents()).toEqual({
      totalTaxCents: 0,
      exemptCents: 10_000,
    });

    const updated = await updateCustomerTaxExemption(ownerId, exemption.id, {
      reason: "RESALE",
      certificateNumber: "RESALE-124",
      jurisdictionIds: [taxFixture.jurisdictionId],
      validFrom: new Date("2026-01-01T07:00:00.000Z"),
      expiresOn: new Date("2026-11-30T07:00:00.000Z"),
    });
    expect(updated.certificateNumber).toBe("RESALE-124");
    expect(updated.jurisdictionIds).toEqual([taxFixture.jurisdictionId]);
  });

  it("stops applying a revoked exemption from the revocation instant forward", async () => {
    const revokedAt = new Date("2026-10-08T18:00:00.000Z");
    await revokeCustomerTaxExemption(ownerId, exemptionId, revokedAt);

    expect(
      (await rentalTaxCents(new Date("2026-10-08T17:59:59.000Z")))
        .totalTaxCents,
    ).toBe(0);
    expect(
      (await rentalTaxCents(new Date("2026-10-08T18:00:00.000Z")))
        .totalTaxCents,
    ).toBe(730);

    await expect(
      updateCustomerTaxExemption(ownerId, exemptionId, {
        reason: "RESALE",
        validFrom: new Date("2026-01-01T07:00:00.000Z"),
      }),
    ).rejects.toThrow(/revoked/i);
  });

  it("ignores an exemption after its expiration date", async () => {
    const expired = await createCustomerTaxExemption(ownerId, customerId, {
      reason: "GOVERNMENT",
      validFrom: new Date("2026-01-01T07:00:00.000Z"),
      expiresOn: new Date("2026-09-30T23:59:59.000Z"),
    });

    expect((await rentalTaxCents()).totalTaxCents).toBe(730);

    await revokeCustomerTaxExemption(ownerId, expired.id, taxDate);
  });
});
