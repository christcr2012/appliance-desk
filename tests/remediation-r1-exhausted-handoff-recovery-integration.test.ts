import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { runPendingHandoffs } from "@/domains/jobs/completion";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Remediation R1 exhausted billing handoff recovery (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const agreementId = `r1-recovered-agreement-${tag}`;
  const jobId = `r1-recovered-job-${tag}`;
  const deliveredOn = new Date("2026-09-15T06:00:00.000Z");

  beforeAll(async () => {
    const address = await prisma.serviceAddress.findFirstOrThrow();
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId: address.customerId,
        serviceAddressId: address.id,
        status: "ACTIVE",
        firstDeliveredOn: deliveredOn,
        stripeSubscriptionId: `sub_r1_recovered_${tag}`,
        billingStartedAt: null,
        billingBlockedReason: "Couldn't start billing: provider was unavailable",
      },
    });
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED" } });
    await prisma.jobBillingHandoff.create({
      data: {
        jobId,
        kind: "START_RECURRING_BILLING",
        subjectId: agreementId,
        status: "FAILED",
        attempts: 5,
        lastError: "RETRY: provider was unavailable",
      },
    });
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
  });

  it("finalizes an exhausted handoff after reconciliation has linked the Stripe subscription", async () => {
    await expect(runPendingHandoffs(1)).resolves.toEqual({ done: 1, failed: 0 });

    expect(await prisma.jobBillingHandoff.findFirstOrThrow({ where: { jobId } })).toMatchObject({
      status: "DONE",
      attempts: 6,
      claimedAt: null,
      lastError: null,
    });
    expect(await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).toMatchObject({
      billingStartedAt: deliveredOn,
      billingBlockedReason: null,
      stripeSubscriptionId: `sub_r1_recovered_${tag}`,
    });
  });
});
