import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { RetryLater, claimProviderOperation } from "@/domains/billing/provider-ops";

// Concurrency evidence must only run against CI's disposable local Postgres.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("provider operation claims in disposable Postgres", () => {
  const keys: string[] = [];

  afterAll(async () => {
    if (keys.length > 0) {
      await prisma.providerOperation.deleteMany({ where: { idempotencyKey: { in: keys } } });
    }
  });

  it("allows exactly one of ten concurrent workers to own one fresh provider call", async () => {
    const tag = randomUUID();
    const key = `customer-create-integration-${tag}`;
    keys.push(key);

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) =>
          claimProviderOperation(tx, {
            kind: "CUSTOMER_CREATE",
            subjectType: "Customer",
            subjectId: `customer-${tag}`,
            idempotencyKey: key,
          }),
        ),
      ),
    );

    const owners = attempts.filter(
      (result): result is PromiseFulfilledResult<{ done: false; opId: string; idempotencyKey: string }> =>
        result.status === "fulfilled" && result.value.done === false,
    );
    const retryLater = attempts.filter(
      (result) => result.status === "rejected" && result.reason instanceof RetryLater,
    );
    const unexpected = attempts.filter(
      (result) => result.status === "rejected" && !(result.reason instanceof RetryLater),
    );

    expect(unexpected).toEqual([]);
    expect(owners).toHaveLength(1);
    expect(retryLater).toHaveLength(9);
    expect(await prisma.providerOperation.count({ where: { idempotencyKey: key } })).toBe(1);

    const row = await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(row).toMatchObject({
      status: "PENDING",
      attempts: 1,
      subjectType: "Customer",
      subjectId: `customer-${tag}`,
    });
  });
});
