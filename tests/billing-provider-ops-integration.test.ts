import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  RetryLater,
  claimProviderOperation,
  completeProviderOperation,
} from "@/domains/billing/provider-ops";

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

  it("rejects stale provider evidence after another cancellation retry becomes UNKNOWN", async () => {
    const tag = randomUUID();
    const key = `subscription-cancel-integration-${tag}`;
    const subjectId = `agreement-${tag}`;
    keys.push(key);

    const original = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId,
        idempotencyKey: key,
      }),
    );
    expect(original.done).toBe(false);
    if (original.done) throw new Error("Expected a fresh provider-operation claim.");

    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, original.opId, {
        status: "UNKNOWN",
        error: new Error("simulated lost initial cancellation outcome"),
      }),
    );

    const observed = await prisma.providerOperation.findUniqueOrThrow({
      where: { idempotencyKey: key },
    });
    expect(observed).toMatchObject({ status: "UNKNOWN", attempts: 1 });

    // Two reconcilers can both read provider state while attempt 1 is UNKNOWN.
    // Worker A wins the row lock and retries; its result is ambiguous again.
    // Worker B then presents the stale attempt-1 evidence it gathered earlier.
    const evidenceAttempt = observed.attempts;
    const workerA = await prisma.$transaction((tx) =>
      claimProviderOperation(tx, {
        kind: "SUBSCRIPTION_CANCEL",
        subjectType: "RentalAgreement",
        subjectId,
        idempotencyKey: key,
        reconcileUnknownAfterProviderEvidence: { expectedAttempts: evidenceAttempt },
      }),
    );
    expect(workerA.done).toBe(false);
    if (workerA.done) throw new Error("Expected worker A to reclaim the UNKNOWN operation.");

    await prisma.$transaction((tx) =>
      completeProviderOperation(tx, workerA.opId, {
        status: "UNKNOWN",
        error: new Error("simulated lost retry outcome"),
      }),
    );

    await expect(
      prisma.$transaction((tx) =>
        claimProviderOperation(tx, {
          kind: "SUBSCRIPTION_CANCEL",
          subjectType: "RentalAgreement",
          subjectId,
          idempotencyKey: key,
          reconcileUnknownAfterProviderEvidence: { expectedAttempts: evidenceAttempt },
        }),
      ),
    ).rejects.toBeInstanceOf(RetryLater);

    const finalRow = await prisma.providerOperation.findUniqueOrThrow({
      where: { idempotencyKey: key },
    });
    expect(finalRow).toMatchObject({ status: "UNKNOWN", attempts: 2 });
  });
});
