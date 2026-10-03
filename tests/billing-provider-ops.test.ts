import type { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  RetryLater,
  claimProviderOperation,
  completeProviderOperation,
  runProviderCall,
  sanitizeProviderError,
} from "@/domains/billing/provider-ops";

type Row = {
  id: string;
  kind: "CUSTOMER_CREATE";
  subjectType: string;
  subjectId: string;
  idempotencyKey: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "DRIFT";
  providerObjectId: string | null;
  attempts: number;
  requestedAt: Date;
  updatedAt: Date;
};

function makeTx(queryResults: unknown[][]) {
  const update = vi.fn().mockResolvedValue({});
  const queryRaw = vi.fn().mockImplementation(async () => queryResults.shift() ?? []);
  return {
    tx: {
      $queryRaw: queryRaw,
      providerOperation: { update },
    } as unknown as Prisma.TransactionClient,
    update,
    queryRaw,
  };
}

const input = {
  kind: "CUSTOMER_CREATE" as const,
  subjectType: "Customer",
  subjectId: "customer-1",
  idempotencyKey: "customer-create-customer-1",
};

function row(overrides: Partial<Row> = {}): Row {
  const now = new Date();
  return {
    id: "op-1",
    kind: "CUSTOMER_CREATE",
    subjectType: "Customer",
    subjectId: "customer-1",
    idempotencyKey: "customer-create-customer-1",
    status: "PENDING",
    providerObjectId: null,
    attempts: 1,
    requestedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("provider operation claims", () => {
  it("claims a fresh key and rejects another active claimant", async () => {
    const first = makeTx([[row()]]);
    await expect(claimProviderOperation(first.tx, input)).resolves.toEqual({
      done: false,
      opId: "op-1",
      idempotencyKey: input.idempotencyKey,
    });

    const second = makeTx([[], [row({ requestedAt: new Date(Date.now() - 300_000) })]]);
    await expect(claimProviderOperation(second.tx, input)).rejects.toBeInstanceOf(RetryLater);
    expect(second.update).not.toHaveBeenCalled();
  });

  it("returns the provider object after a completed operation", async () => {
    const { tx } = makeTx([
      [],
      [row({ status: "SUCCEEDED", providerObjectId: "cus_done" })],
    ]);

    await expect(claimProviderOperation(tx, input)).resolves.toEqual({
      done: true,
      providerObjectId: "cus_done",
    });
  });

  it("takes over a stale pending operation using updatedAt without moving requestedAt", async () => {
    const originalRequestedAt = new Date(Date.now() - 3_600_000);
    const { tx, update } = makeTx([
      [],
      [
        row({
          requestedAt: originalRequestedAt,
          updatedAt: new Date(Date.now() - 300_000),
          attempts: 2,
        }),
      ],
    ]);

    await expect(claimProviderOperation(tx, input)).resolves.toEqual({
      done: false,
      opId: "op-1",
      idempotencyKey: input.idempotencyKey,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        completedAt: null,
        lastError: null,
      }),
    });
    expect(update.mock.calls[0]?.[0]?.data).not.toHaveProperty("requestedAt");
  });

  it("does not blindly retry an UNKNOWN outcome", async () => {
    const { tx, update } = makeTx([[], [row({ status: "UNKNOWN" })]]);
    await expect(claimProviderOperation(tx, input)).rejects.toThrow(/reconciled/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows UNKNOWN takeover only after reconciliation has provider evidence", async () => {
    const originalRequestedAt = new Date(Date.now() - 3_600_000);
    const { tx, update } = makeTx([
      [],
      [
        row({
          status: "UNKNOWN",
          requestedAt: originalRequestedAt,
          updatedAt: new Date(),
          attempts: 2,
        }),
      ],
    ]);

    await expect(
      claimProviderOperation(tx, {
        ...input,
        reconcileUnknownAfterProviderEvidence: true,
      }),
    ).resolves.toEqual({
      done: false,
      opId: "op-1",
      idempotencyKey: input.idempotencyKey,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        completedAt: null,
        lastError: null,
      }),
    });
    expect(update.mock.calls[0]?.[0]?.data).not.toHaveProperty("requestedAt");
  });

  it("rejects accidental reuse of one idempotency key for another subject", async () => {
    const { tx } = makeTx([[], [row({ subjectId: "someone-else" })]]);
    await expect(claimProviderOperation(tx, input)).rejects.toThrow(/different subject/i);
  });
});

describe("provider call outcome classification", () => {
  it("maps Stripe connection and API/server failures to UNKNOWN", async () => {
    const connectionError = new Stripe.errors.StripeConnectionError({
      message: "network timeout",
    });
    const apiError = new Stripe.errors.StripeAPIError({
      message: "server unavailable",
    });

    await expect(runProviderCall(async () => Promise.reject(connectionError))).resolves.toMatchObject({
      ok: false,
      outcome: "UNKNOWN",
    });
    await expect(runProviderCall(async () => Promise.reject(apiError))).resolves.toMatchObject({
      ok: false,
      outcome: "UNKNOWN",
    });
  });

  it("maps invalid requests and card errors to FAILED", async () => {
    const invalid = new Stripe.errors.StripeInvalidRequestError({
      message: "bad parameter",
      type: "invalid_request_error",
    });
    const card = new Stripe.errors.StripeCardError({
      message: "declined",
      type: "card_error",
    });

    await expect(runProviderCall(async () => Promise.reject(invalid))).resolves.toMatchObject({
      ok: false,
      outcome: "FAILED",
    });
    await expect(runProviderCall(async () => Promise.reject(card))).resolves.toMatchObject({
      ok: false,
      outcome: "FAILED",
    });
  });

  it("returns successful values unchanged", async () => {
    await expect(runProviderCall(async () => ({ id: "cus_123" }))).resolves.toEqual({
      ok: true,
      value: { id: "cus_123" },
    });
  });
});

describe("provider operation completion and redaction", () => {
  it("persists a sanitized failure without leaking a key or card-like number", async () => {
    const { tx, update } = makeTx([[{ status: "PENDING", providerObjectId: null }]]);
    await completeProviderOperation(tx, "op-1", {
      status: "FAILED",
      error: new Error("key sk_test_abc123 card 4242424242424242 failed"),
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: expect.objectContaining({
        status: "FAILED",
        lastError: "key [REDACTED_KEY] card [REDACTED_NUMBER] failed",
      }),
    });
  });

  it("never lets a late ambiguous result downgrade a known success", async () => {
    const { tx, update } = makeTx([[{ status: "SUCCEEDED", providerObjectId: "cus_123" }]]);
    await completeProviderOperation(tx, "op-1", {
      status: "UNKNOWN",
      error: new Error("late timeout"),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("redacts provider secrets and caps persisted diagnostics", () => {
    const long = `sk_test_supersecret pk_live_publicish 4000000000000002 ${"x".repeat(700)}`;
    const sanitized = sanitizeProviderError(long);
    expect(sanitized).not.toContain("sk_test_supersecret");
    expect(sanitized).not.toContain("pk_live_publicish");
    expect(sanitized).not.toContain("4000000000000002");
    expect(sanitized.length).toBeLessThanOrEqual(500);
  });
});
