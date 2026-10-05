import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAgreementInTx } from "@/domains/agreements";
import { startRenewalInTx } from "@/domains/agreements/renewal-start";
import { createJob } from "@/domains/jobs";
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Remediation R1 cancelled-renewal lineage guard (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r1-cancel-lineage-owner-${tag}`;
  const customerUserId = `r1-cancel-lineage-user-${tag}`;
  const customerId = `r1-cancel-lineage-customer-${tag}`;
  const addressId = `r1-cancel-lineage-address-${tag}`;
  const typeId = `r1-cancel-lineage-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];

  async function fixture(suffix: string) {
    const oldId = `r1-cancel-old-${suffix}-${tag}`;
    const renewalId = `r1-cancel-new-${suffix}-${tag}`;
    const applianceId = `r1-cancel-unit-${suffix}-${tag}`;
    agreementIds.push(oldId, renewalId);
    applianceIds.push(applianceId);

    const old = await prisma.rentalAgreement.create({
      data: {
        id: oldId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        startDate: businessDateFromKey("2026-04-01"),
        firstDeliveredOn: businessDateFromKey("2026-04-01"),
        billingStartedAt: businessDateFromKey("2026-04-01"),
        lines: { create: { label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4000 } },
      },
      include: { lines: true },
    });
    const renewal = await prisma.rentalAgreement.create({
      data: {
        id: renewalId,
        customerId,
        serviceAddressId: addressId,
        status: "SCHEDULED",
        renewedFromAgreementId: oldId,
        startDate: businessDateFromKey("2026-10-01"),
        lines: { create: { label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4000 } },
      },
    });
    await prisma.appliance.create({
      data: {
        id: applianceId,
        assetNumber: `R1CL-${suffix}-${tag.slice(0, 6)}`,
        applianceTypeId: typeId,
        status: "RENTED",
      },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: old.lines[0]!.id, applianceId },
    });
    return { old, renewal };
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${tag}-cancel-lineage-owner@example.test`,
          name: "R1 Cancel Lineage Owner",
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: customerUserId,
          email: `${tag}-cancel-lineage-customer@example.test`,
          name: "R1 Cancel Lineage Customer",
          role: "CUSTOMER",
          emailVerified: true,
        },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: `RCL${tag.slice(0, 17)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "3 Remediation Way", city: "Greeley", zip: "80631" },
    });
    await prisma.applianceType.create({
      data: {
        id: typeId,
        name: `R1 Cancel Lineage Type ${tag}`,
        slug: `r1-cancel-lineage-type-${tag}`,
        monthlyPriceCents: 4000,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: ownerId },
          { entityId: { in: [...agreementIds, ...jobIds, ...applianceIds] } },
        ],
      },
    });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("allows predecessor field work when a scheduled renewal was cancelled before it started", async () => {
    const { old, renewal } = await fixture("before-start");
    await prisma.$transaction((tx) => closeAgreementInTx(tx, ownerId, renewal.id, "CANCELLED"));

    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("ACTIVE");
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("CANCELLED");

    const job = await createJob(ownerId, {
      type: "REMOVAL",
      customerId,
      serviceAddressId: addressId,
      agreementId: old.id,
    });
    jobIds.push(job.id);
    expect(job.agreementId).toBe(old.id);
  });

  it("rejects predecessor field work when a renewal started and was later cancelled", async () => {
    const { old, renewal } = await fixture("after-start");
    const started = await prisma.$transaction((tx) =>
      startRenewalInTx(tx, renewal.id, new Date("2026-10-02T18:00:00.000Z")),
    );
    expect(started.started).toBe(true);

    await prisma.$transaction((tx) => closeAgreementInTx(tx, ownerId, renewal.id, "CANCELLED"));
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("ENDED");
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("CANCELLED");
    expect(
      await prisma.auditLog.count({
        where: {
          action: "agreement.renewal_started",
          entityType: "RentalAgreement",
          entityId: renewal.id,
        },
      }),
    ).toBe(1);

    await expect(
      createJob(ownerId, {
        type: "REMOVAL",
        customerId,
        serviceAddressId: addressId,
        agreementId: old.id,
      }),
    ).rejects.toThrow("already renewed");
    expect(await prisma.job.count({ where: { agreementId: old.id } })).toBe(0);
  });
});
