import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { startRenewalInTx } from "@/domains/agreements/renewal-start";
import { completeJob } from "@/domains/jobs/completion";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Remediation R1 renewal and field-work lineage (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r1-ren-owner-${tag}`;
  const customerUserId = `r1-ren-user-${tag}`;
  const customerId = `r1-ren-customer-${tag}`;
  const addressId = `r1-ren-address-${tag}`;
  const typeId = `r1-ren-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];

  async function fixture(suffix: string) {
    const oldId = `r1-old-${suffix}-${tag}`;
    const renewalId = `r1-new-${suffix}-${tag}`;
    const applianceId = `r1-ren-unit-${suffix}-${tag}`;
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
      include: { lines: true },
    });
    await prisma.appliance.create({
      data: {
        id: applianceId,
        assetNumber: `R1R-${suffix}-${tag.slice(0, 6)}`,
        applianceTypeId: typeId,
        status: "RENTED",
      },
    });
    await prisma.applianceAssignment.create({ data: { rentalLineId: old.lines[0]!.id, applianceId } });
    return { old, renewal, applianceId };
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-ren-owner@example.test`, name: "R1 Renewal Owner", role: "OWNER", emailVerified: true },
        { id: customerUserId, email: `${tag}-ren-customer@example.test`, name: "R1 Renewal Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: `RR${tag.slice(0, 18)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "2 Remediation Way", city: "Greeley", zip: "80631" },
    });
    await prisma.applianceType.create({
      data: { id: typeId, name: `R1 Renewal Type ${tag}`, slug: `r1-ren-type-${tag}`, monthlyPriceCents: 4000 },
    });
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: ownerId },
          { entityId: { in: [...jobIds, ...agreementIds, ...applianceIds] } },
        ],
      },
    });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.deposit.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it.each(["REMOVAL", "DELIVERY", "INSTALLATION"] as const)(
    "refuses renewal while the old agreement has an open %s job, then starts after the conflict is cancelled",
    async (type) => {
      const { old, renewal, applianceId } = await fixture(type.toLowerCase());
      const jobId = `r1-ren-conflict-${type}-${tag}`;
      jobIds.push(jobId);
      await prisma.job.create({
        data: {
          id: jobId,
          type,
          status: "SCHEDULED",
          customerId,
          serviceAddressId: addressId,
          agreementId: old.id,
        },
      });

      const blocked = await prisma.$transaction((tx) =>
        startRenewalInTx(tx, renewal.id, new Date("2026-10-02T18:00:00.000Z")),
      );
      expect(blocked).toMatchObject({ started: false, reason: "OPEN_JOB_CONFLICT" });
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("ACTIVE");
      const beforeAssignment = await prisma.applianceAssignment.findFirstOrThrow({
        where: { applianceId, unassignedAt: null },
        select: { rentalLine: { select: { agreementId: true } } },
      });
      expect(beforeAssignment.rentalLine.agreementId).toBe(old.id);

      await prisma.job.update({ where: { id: jobId }, data: { status: "CANCELLED" } });
      const started = await prisma.$transaction((tx) =>
        startRenewalInTx(tx, renewal.id, new Date("2026-10-02T18:00:00.000Z")),
      );
      expect(started).toMatchObject({ started: true, renewalId: renewal.id, endedAgreementId: old.id, appliancesMoved: 1 });
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("ENDED");
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("ACTIVE");
      const afterAssignment = await prisma.applianceAssignment.findFirstOrThrow({
        where: { applianceId, unassignedAt: null },
        select: { rentalLine: { select: { agreementId: true } } },
      });
      expect(afterAssignment.rentalLine.agreementId).toBe(renewal.id);
    },
  );

  it("allows a staged SWAP to remain open while renewal moves the current assignment", async () => {
    const { old, renewal, applianceId } = await fixture("swap");
    const swapJobId = `r1-ren-swap-${tag}`;
    jobIds.push(swapJobId);
    await prisma.job.create({
      data: {
        id: swapJobId,
        type: "SWAP",
        status: "SCHEDULED",
        customerId,
        serviceAddressId: addressId,
        agreementId: old.id,
        appliances: { create: [{ applianceId, role: "PRIMARY" }] },
      },
    });

    const result = await prisma.$transaction((tx) =>
      startRenewalInTx(tx, renewal.id, new Date("2026-10-02T18:00:00.000Z")),
    );
    expect(result.started).toBe(true);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: swapJobId } })).status).toBe("SCHEDULED");
    const current = await prisma.applianceAssignment.findFirstOrThrow({
      where: { applianceId, unassignedAt: null },
      select: { rentalLine: { select: { agreementId: true } } },
    });
    expect(current.rentalLine.agreementId).toBe(renewal.id);
  });

  it("a stale old-agreement removal cannot mutate an appliance after its assignment moved to the renewal", async () => {
    const { old, renewal, applianceId } = await fixture("stale");
    const started = await prisma.$transaction((tx) =>
      startRenewalInTx(tx, renewal.id, new Date("2026-10-02T18:00:00.000Z")),
    );
    expect(started.started).toBe(true);

    const staleJobId = `r1-ren-stale-removal-${tag}`;
    jobIds.push(staleJobId);
    await prisma.job.create({
      data: {
        id: staleJobId,
        type: "REMOVAL",
        status: "IN_PROGRESS",
        customerId,
        serviceAddressId: addressId,
        agreementId: old.id,
        appliances: { create: [{ applianceId }] },
      },
    });

    await expect(
      completeJob(ownerId, {
        jobId: staleJobId,
        expectedVersion: 1,
        completionKey: `r1-stale-${randomUUID()}`,
        performedOn: businessDateFromKey("2026-10-03"),
        completionNotes: null,
        results: [{ applianceId, result: "RETURNED" }],
      }),
    ).rejects.toThrow();

    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } })).status).toBe("RENTED");
    const current = await prisma.applianceAssignment.findFirstOrThrow({
      where: { applianceId, unassignedAt: null },
      select: { rentalLine: { select: { agreementId: true } } },
    });
    expect(current.rentalLine.agreementId).toBe(renewal.id);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: staleJobId } })).status).toBe("IN_PROGRESS");
  });
});
