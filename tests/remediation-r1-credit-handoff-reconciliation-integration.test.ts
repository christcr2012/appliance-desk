import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  listBalanceTransactions: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    customers: {
      listBalanceTransactions: (...args: unknown[]) => stripeMock.listBalanceTransactions(...args),
    },
  }),
}));

import { prisma } from "@/lib/prisma";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Remediation R1 exhausted credit handoff reconciliation (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `r1-credit-user-${tag}`;
  const customerId = `r1-credit-customer-${tag}`;
  const creditId = `r1-credit-${tag}`;
  const jobId = `r1-credit-job-${tag}`;
  const operationId = `r1-credit-op-${tag}`;
  const transactionId = `cbtxn_r1_${tag}`;

  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.listBalanceTransactions.mockResolvedValue({
      data: [
        {
          id: transactionId,
          created: 1_800_000_000,
          metadata: { creditId },
        },
      ],
      has_more: false,
    });
  });

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${tag}@example.test`,
        name: "R1 Credit Customer",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `RC${tag.slice(0, 16)}`,
        stripeCustomerId: `cus_r1_${tag}`,
      },
    });
    await prisma.customerCredit.create({
      data: {
        id: creditId,
        customerId,
        amountCents: 2_500,
        remainingCents: 2_500,
        reason: "Late delivery credit",
        sourceType: "LATE_DELIVERY",
        sourceId: `pending-${tag}`,
        side: "CUSTOMER",
      },
    });
    await prisma.job.create({
      data: { id: jobId, type: "DELIVERY", status: "COMPLETED" },
    });
    await prisma.jobBillingHandoff.create({
      data: {
        jobId,
        kind: "PUSH_CREDIT",
        subjectId: creditId,
        status: "FAILED",
        attempts: 5,
        lastError: "RETRY: provider was unavailable",
      },
    });
    await prisma.providerOperation.create({
      data: {
        id: operationId,
        kind: "BALANCE_CREDIT",
        subjectType: "CustomerCredit",
        subjectId: creditId,
        idempotencyKey: `late-delivery-credit-${creditId}`,
        status: "FAILED",
        attempts: 5,
        lastError: "provider was unavailable",
        requestedAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId } });
    await prisma.providerOperation.deleteMany({ where: { id: operationId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.customerCredit.deleteMany({ where: { id: creditId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("marks an exhausted PUSH_CREDIT handoff DONE when provider reconciliation proves success", async () => {
    await expect(finishPendingProviderOperations(1)).resolves.toEqual({
      completed: 1,
      stillUnknown: 0,
    });

    expect(await prisma.providerOperation.findUniqueOrThrow({ where: { id: operationId } })).toMatchObject({
      status: "SUCCEEDED",
      providerObjectId: transactionId,
    });
    expect(await prisma.customerCredit.findUniqueOrThrow({ where: { id: creditId } })).toMatchObject({
      remainingCents: 0,
    });
    expect((await prisma.customerCredit.findUniqueOrThrow({ where: { id: creditId } })).appliedViaStripeAt).not.toBeNull();
    expect(await prisma.jobBillingHandoff.findFirstOrThrow({ where: { jobId } })).toMatchObject({
      status: "DONE",
      attempts: 5,
      claimedAt: null,
      lastError: null,
    });
  });
});
