import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { recordLateDeliveries } from "@/domains/billing/pickup-billing-events";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Remediation R1 delayed-provider late-delivery credit (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r1-credit-owner-${tag}`;
  const userId = `r1-credit-user-${tag}`;
  const customerId = `r1-credit-customer-${tag}`;
  const addressId = `r1-credit-address-${tag}`;
  const agreementId = `r1-credit-agreement-${tag}`;
  const typeId = `r1-credit-type-${tag}`;
  const applianceId = `r1-credit-unit-${tag}`;
  const originalJobId = `r1-credit-original-${tag}`;
  const deliveredJobId = `r1-credit-delivered-${tag}`;
  let pendingId = "";

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-credit-owner@example.test`, role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-credit-user@example.test`, role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `RC${tag.slice(0, 18)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "3 Remediation Way", city: "Greeley", zip: "80631" },
    });
    await prisma.applianceType.create({
      data: { id: typeId, name: `R1 Credit Type ${tag}`, slug: `r1-credit-${tag}`, monthlyPriceCents: 3000 },
    });
    const agreement = await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        firstDeliveredOn: businessDateFromKey("2026-10-01"),
        billingStartedAt: null,
        lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } },
      },
      include: { lines: true },
    });
    await prisma.appliance.create({
      data: {
        id: applianceId,
        assetNumber: `R1C-${tag.slice(0, 8)}`,
        applianceTypeId: typeId,
        status: "RESERVED",
      },
    });
    await prisma.applianceAssignment.create({ data: { rentalLineId: agreement.lines[0]!.id, applianceId } });
    await prisma.job.createMany({
      data: [
        { id: originalJobId, type: "DELIVERY", status: "COMPLETED", customerId, serviceAddressId: addressId, agreementId },
        { id: deliveredJobId, type: "DELIVERY", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId },
      ],
    });
    const pending = await prisma.pendingDelivery.create({
      data: {
        agreementId,
        rentalLineId: agreement.lines[0]!.id,
        applianceId,
        originalJobId,
        originalDeliveryDate: businessDateFromKey("2026-10-01")!,
      },
    });
    pendingId = pending.id;
  });

  afterAll(async () => {
    const creditIds = (await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } })).map((row) => row.id);
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: [originalJobId, deliveredJobId] } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: ownerId },
          { entityType: "CustomerCredit", entityId: { in: creditIds } },
          { entityId: { in: [pendingId, agreementId, originalJobId, deliveredJobId, applianceId] } },
        ],
      },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId } });
    await prisma.job.deleteMany({ where: { id: { in: [originalJobId, deliveredJobId] } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: applianceId } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("credits missing days from first delivery even before Stripe subscription recovery populates billingStartedAt", async () => {
    const outcome = await prisma.$transaction((tx) =>
      recordLateDeliveries(tx, {
        userId: ownerId,
        jobId: deliveredJobId,
        agreementId,
        applianceIds: [applianceId],
        deliveryDate: businessDateFromKey("2026-10-11")!,
      }),
    );

    expect(outcome.creditIds).toHaveLength(1);
    expect(outcome.creditCents).toBeGreaterThan(0);
    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(agreement.billingStartedAt).toBeNull();
    expect(agreement.firstDeliveredOn?.getTime()).toBe(businessDateFromKey("2026-10-01")!.getTime());
    const pending = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: pendingId } });
    expect(pending.deliveredOn?.getTime()).toBe(businessDateFromKey("2026-10-11")!.getTime());
    expect(pending.creditId).toBe(outcome.creditIds[0]);
  });
});
