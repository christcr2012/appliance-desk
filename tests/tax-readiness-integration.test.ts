import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertTaxReadyForAgreement, TaxNotReadyError } from "@/domains/tax/locations";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T tax readiness (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `tax-ready-user-${tag}`;
  const customerId = `tax-ready-customer-${tag}`;
  const addressId = `tax-ready-address-${tag}`;
  const agreementId = `tax-ready-agreement-${tag}`;
  const jurisdictionId = `tax-ready-jurisdiction-${tag}`;
  const rateId = `tax-ready-rate-${tag}`;
  let originalElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS";

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { shortTermLeaseElection: true },
    });
    originalElection = settings.shortTermLeaseElection;
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, role: "CUSTOMER" } });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `TR${tag.slice(0, 10)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Ready Test Way", city: "Greeley", state: "CO", zip: "80631" },
    });
    await prisma.rentalAgreement.create({
      data: { id: agreementId, customerId, serviceAddressId: addressId, status: "DRAFT" },
    });
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId,
        code: `TR-${tag.slice(0, 8)}`,
        name: "Synthetic Ready Jurisdiction",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
  });

  beforeEach(async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: "COLLECT_ON_RENTALS" },
    });
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { damageWaiverCents: 0, lateFeeCents: 0, lateFeePercent: 0 },
    });
    await prisma.taxJurisdiction.update({
      where: { id: jurisdictionId },
      data: { reviewStatus: "REVIEWED", administration: "STATE_COLLECTED" },
    });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
    await prisma.taxRateVersion.create({
      data: {
        id: rateId,
        jurisdictionId,
        rateMilliPercent: 1000,
        effectiveFrom: businessDateFromKey(businessDateKey(new Date())) ?? new Date(),
        source: "MANUAL",
      },
    });
    await prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId: addressId } });
    await prisma.addressTaxLocation.create({
      data: {
        serviceAddressId: addressId,
        status: "VERIFIED",
        source: "MANUAL",
        lookedUpAt: new Date(),
        jurisdictions: { create: { jurisdictionId } },
      },
    });
  });

  afterAll(async () => {
    await prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId: addressId } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
    await prisma.taxabilityRule.deleteMany({ where: { jurisdictionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: originalElection },
    });
  });

  async function problems(): Promise<string[]> {
    try {
      await prisma.$transaction((tx) => assertTaxReadyForAgreement(tx, agreementId));
      return [];
    } catch (error) {
      expect(error).toBeInstanceOf(TaxNotReadyError);
      return (error as TaxNotReadyError).problems;
    }
  }

  it("passes when election, address, jurisdiction, rate and rental policy are ready", async () => {
    await expect(
      prisma.$transaction((tx) => assertTaxReadyForAgreement(tx, agreementId)),
    ).resolves.toBeUndefined();
  });

  it("blocks an undecided short-term rental election", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: "UNDECIDED" },
    });
    expect(await problems()).toContain("Choose the short-term rental tax treatment before billing.");
  });

  it("blocks an address without a verified current tax location", async () => {
    await prisma.addressTaxLocation.updateMany({
      where: { serviceAddressId: addressId, isCurrent: true },
      data: { status: "NEEDS_REVIEW" },
    });
    expect(await problems()).toContain("Confirm the tax areas for this service address before billing.");
  });

  it("blocks an unreviewed jurisdiction", async () => {
    await prisma.taxJurisdiction.update({
      where: { id: jurisdictionId },
      data: { reviewStatus: "NEEDS_REVIEW" },
    });
    expect(await problems()).toContain("Review Synthetic Ready Jurisdiction before billing.");
  });

  it("blocks a jurisdiction without an effective rate", async () => {
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
    expect((await problems()).some((problem) => problem.startsWith("Enter a tax rate for Synthetic Ready Jurisdiction"))).toBe(true);
  });

  it("blocks an agreement fee whose taxability is undecided", async () => {
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { damageWaiverCents: 500 },
    });
    expect(await problems()).toContain(
      "damage waiver in Synthetic Ready Jurisdiction: decide whether it is taxable before billing.",
    );
  });
});
