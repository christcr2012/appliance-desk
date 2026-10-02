import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ customerCreate: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    customers: { create: (...args: unknown[]) => m.customerCreate(...args) },
  }),
}));
vi.mock("@/domains/referrals", () => ({ rewardReferralIfEligible: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { RetryLater } from "@/domains/billing/provider-ops";
import { ensureStripeCustomer } from "@/domains/billing/checkout";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("ensureStripeCustomer in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `stripe-user-${tag}`;
  const customerId = `stripe-customer-${tag}`;
  const key = `customer-create-${customerId}`;

  beforeEach(() => {
    m.customerCreate.mockReset().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      return { id: `cus_${tag}` };
    });
  });

  afterAll(async () => {
    await prisma.providerOperation.deleteMany({ where: { idempotencyKey: key } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("creates at most one Stripe customer under five concurrent first-billing attempts", async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${tag}@example.test`,
        name: "Concurrent Stripe Customer",
        role: "CUSTOMER",
      },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `ref-${tag}` },
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => ensureStripeCustomer(customerId)),
    );

    const unexpectedFailures = attempts.filter(
      (result) => result.status === "rejected" && !(result.reason instanceof RetryLater),
    );
    expect(unexpectedFailures).toEqual([]);
    expect(m.customerCreate).toHaveBeenCalledTimes(1);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.stripeCustomerId).toBe(`cus_${tag}`);

    const fulfilledIds = attempts
      .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
      .map((result) => result.value);
    expect(new Set(fulfilledIds)).toEqual(new Set([`cus_${tag}`]));

    // Once the winning call has persisted the provider id, every retry is a
    // plain local read and must never issue a second Stripe create.
    await expect(ensureStripeCustomer(customerId)).resolves.toBe(`cus_${tag}`);
    expect(m.customerCreate).toHaveBeenCalledTimes(1);

    const op = await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(op).toMatchObject({
      status: "SUCCEEDED",
      providerObjectId: `cus_${tag}`,
      subjectType: "Customer",
      subjectId: customerId,
    });
  });
});
