import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  addRentalLine,
  cancelAgreement,
  sendForSignature,
  signAgreement,
} from "@/domains/agreements";
import {
  approveEstimate,
  convertEstimateToAgreements,
  requestEstimateChanges,
} from "@/domains/estimates";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("agreement + estimate lifecycle concurrency", () => {
  const tag = randomUUID();
  let ownerId: string;
  let customerUserId: string;
  let customerId: string;
  let addressId: string;
  let applianceTypeId: string;
  let taxReady: Awaited<ReturnType<typeof seedTaxReadyContext>> | null = null;
  const estimateIds: string[] = [];
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];

  beforeAll(async () => {
    ownerId = (
      await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })
    ).id;
    customerUserId = (
      await prisma.user.create({
        data: {
          email: `lifecycle-${tag}@example.test`,
          name: "Lifecycle Concurrency",
          role: "CUSTOMER",
          emailVerified: true,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          userId: customerUserId,
          referralCode: `LC-${tag}`,
        },
      })
    ).id;
    addressId = (
      await prisma.serviceAddress.create({
        data: {
          customerId,
          line1: "1 Concurrency Way",
          city: "Greeley",
          state: "CO",
          zip: "80631",
        },
      })
    ).id;
    taxReady = await seedTaxReadyContext(addressId);
    applianceTypeId = (
      await prisma.applianceType.create({
        data: {
          name: `Concurrency Washer ${tag}`,
          slug: `concurrency-washer-${tag}`,
          monthlyPriceCents: 3500,
        },
      })
    ).id;
  });

  afterAll(async () => {
    const linkedAgreementIds = (
      await prisma.rentalAgreement.findMany({
        where: {
          OR: [
            { id: { in: agreementIds } },
            { sourceEstimateId: { in: estimateIds } },
          ],
        },
        select: { id: true },
      })
    ).map((row) => row.id);

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: estimateIds } },
          { entityId: { in: linkedAgreementIds } },
        ],
      },
    });
    await prisma.deposit.deleteMany({
      where: { agreementId: { in: linkedAgreementIds } },
    });
    await prisma.receipt.deleteMany({ where: { customerId } });
    const lineIds = (
      await prisma.rentalLine.findMany({
        where: { agreementId: { in: linkedAgreementIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.applianceAssignment.deleteMany({
      where: { rentalLineId: { in: lineIds } },
    });
    await prisma.signatureRecord.deleteMany({
      where: { agreementId: { in: linkedAgreementIds } },
    });
    await prisma.rentalLine.deleteMany({
      where: { id: { in: lineIds } },
    });
    await prisma.rentalAgreement.deleteMany({
      where: { id: { in: linkedAgreementIds } },
    });
    await prisma.estimateLineItem.deleteMany({
      where: { estimateId: { in: estimateIds } },
    });
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: applianceTypeId } });
    await taxReady?.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: customerUserId } });
  });

  async function createEstimate(status: "SENT" | "APPROVED") {
    const estimate = await prisma.estimate.create({
      data: {
        customerId,
        status,
        title: `Concurrency estimate ${tag}`,
        createdByUserId: ownerId,
        sentAt: status === "SENT" ? new Date() : new Date(Date.now() - 1000),
        respondedAt: status === "APPROVED" ? new Date() : null,
        approverName: status === "APPROVED" ? "Customer" : null,
        approverEmail:
          status === "APPROVED" ? `lifecycle-${tag}@example.test` : null,
        depositCents: 2500,
        depositPaidAt: status === "APPROVED" ? new Date() : null,
        lineItems: {
          create: {
            serviceAddressId: addressId,
            description: "Washer rental",
            quantity: 1,
            monthlyPriceCents: 3500,
          },
        },
      },
    });
    estimateIds.push(estimate.id);

    if (status === "APPROVED") {
      const receipt = await prisma.receipt.create({
        data: {
          customerId,
          source: "STRIPE",
          amountCents: 2500,
          method: "card",
          stripeChargeId: `ch_estimate_concurrency_${estimate.id}`,
          receivedOn: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: null,
          action: "estimate.deposit_source_receipt",
          entityType: "Estimate",
          entityId: estimate.id,
          newValue: {
            receiptId: receipt.id,
            paymentIntentId: `pi_estimate_concurrency_${estimate.id}`,
          },
        },
      });
    }

    return estimate.id;
  }

  it("approval and change-request races produce exactly one terminal response", async () => {
    const estimateId = await createEstimate("SENT");

    const results = await Promise.allSettled([
      approveEstimate(estimateId, {
        approverName: "Concurrency Customer",
        approverEmail: `lifecycle-${tag}@example.test`,
        ipAddress: "127.0.0.1",
      }),
      requestEstimateChanges(estimateId, "Please revise the delivery timing."),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const stored = await prisma.estimate.findUniqueOrThrow({
      where: { id: estimateId },
    });
    expect(["APPROVED", "CHANGES_REQUESTED"]).toContain(stored.status);
    expect(stored.respondedAt).not.toBeNull();
    if (stored.status === "APPROVED") {
      expect(stored.approverName).toBe("Concurrency Customer");
      expect(stored.changesRequestedMessage).toBeNull();
    } else {
      expect(stored.changesRequestedMessage).toBe(
        "Please revise the delivery timing.",
      );
    }
  });

  it("concurrent estimate conversion creates one agreement/deposit/audit and both callers reconcile to it", async () => {
    const estimateId = await createEstimate("APPROVED");

    const [first, second] = await Promise.all([
      convertEstimateToAgreements(ownerId, estimateId, {
        mode: "single",
        serviceAddressId: addressId,
      }),
      convertEstimateToAgreements(ownerId, estimateId, {
        mode: "single",
        serviceAddressId: addressId,
      }),
    ]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    agreementIds.push(...first);

    const agreements = await prisma.rentalAgreement.findMany({
      where: { sourceEstimateId: estimateId },
    });
    expect(agreements).toHaveLength(1);
    const deposit = await prisma.deposit.findFirstOrThrow({
      where: { agreementId: agreements[0]!.id, amountCents: 2500 },
    });
    expect(deposit.sourceReceiptId).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { entityId: estimateId, action: "estimate.convert" },
      }),
    ).toBe(1);
    expect(
      (await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } }))
        .status,
    ).toBe("CONVERTED");
  });

  it("sign/cancel races never leave an ACTIVE agreement with inventory released", async () => {
    const firstAppliance = await prisma.appliance.create({
      data: {
        assetNumber: `CONC-A-${tag}`,
        applianceTypeId,
        status: "AVAILABLE",
      },
    });
    applianceIds.push(firstAppliance.id);

    const agreement = await prisma.rentalAgreement.create({
      data: { customerId, serviceAddressId: addressId, status: "DRAFT" },
    });
    agreementIds.push(agreement.id);

    await addRentalLine(ownerId, agreement.id, {
      label: "Concurrency washer",
      listPriceCents: 3500,
      applianceIds: [firstAppliance.id],
    });
    const signature = await sendForSignature(ownerId, agreement.id);

    await Promise.allSettled([
      signAgreement(signature.id, {
        signerName: "Concurrency Customer",
        signerEmail: `lifecycle-${tag}@example.test`,
        ipAddress: "127.0.0.1",
      }),
      cancelAgreement(ownerId, agreement.id),
    ]);

    const [storedAgreement, storedAppliance] = await Promise.all([
      prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } }),
      prisma.appliance.findUniqueOrThrow({ where: { id: firstAppliance.id } }),
    ]);

    expect(["ACTIVE", "CANCELLED"]).toContain(storedAgreement.status);
    if (storedAgreement.status === "ACTIVE") {
      expect(storedAppliance.status).toBe("RESERVED");
    } else {
      expect(storedAppliance.status).toBe("AVAILABLE");
    }
  });
});