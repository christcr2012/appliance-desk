import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export type ProviderOpKind =
  | "RDF_INVOICE_ITEM"
  | "CUSTOMER_CREATE"
  | "SUBSCRIPTION_CREATE"
  | "SUBSCRIPTION_CANCEL"
  | "SUBSCRIPTION_UPDATE"
  | "BALANCE_CREDIT"
  | "REFUND_CREATE"
  | "TAX_RATE_CREATE"
  | "SUBSCRIPTION_TAX_UPDATE";

type ProviderOpStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "DRIFT"
  | "SUPERSEDED";

type ProviderOperationRow = {
  id: string;
  kind: ProviderOpKind;
  subjectType: string;
  subjectId: string;
  idempotencyKey: string;
  status: ProviderOpStatus;
  providerObjectId: string | null;
  attempts: number;
  requestedAt: Date;
  updatedAt: Date;
};

/** Shared lease window for durable provider work and job billing handoffs. */
export const PROVIDER_OPERATION_LEASE_MS = 120_000;

export class RetryLater extends Error {
  constructor(message = "This provider operation is already in progress. Try again shortly.") {
    super(message);
    this.name = "RetryLater";
  }
}

function providerRowMatches(
  row: Pick<ProviderOperationRow, "kind" | "subjectType" | "subjectId" | "idempotencyKey">,
  input: { kind: ProviderOpKind; subjectType: string; subjectId: string; idempotencyKey: string },
) {
  return (
    row.kind === input.kind &&
    row.subjectType === input.subjectType &&
    row.subjectId === input.subjectId &&
    row.idempotencyKey === input.idempotencyKey
  );
}

/**
 * Claim one durable provider write without holding a database lock across the
 * network call. A fresh idempotency key is inserted atomically. If the key
 * already exists, its row is locked before deciding whether the operation is
 * finished, actively owned, stale/retryable, or awaiting reconciliation.
 */
export async function claimProviderOperation(
  tx: Prisma.TransactionClient,
  input: {
    kind: ProviderOpKind;
    subjectType: string;
    subjectId: string;
    idempotencyKey: string;
    staleAfterMs?: number;
    reconcileUnknownAfterProviderEvidence?: { expectedAttempts: number };
  },
): Promise<
  | { done: true; providerObjectId: string }
  | { done: false; opId: string; idempotencyKey: string }
> {
  const staleAfterMs = input.staleAfterMs ?? PROVIDER_OPERATION_LEASE_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new Error("staleAfterMs must be a non-negative finite number.");
  }
  if (!input.subjectType || !input.subjectId || !input.idempotencyKey) {
    throw new Error("Provider operation subject and idempotency key are required.");
  }

  const expectedUnknownAttempts =
    input.reconcileUnknownAfterProviderEvidence?.expectedAttempts;
  if (
    expectedUnknownAttempts !== undefined &&
    (!Number.isInteger(expectedUnknownAttempts) || expectedUnknownAttempts < 1)
  ) {
    throw new Error("UNKNOWN reconciliation expectedAttempts must be a positive integer.");
  }

  const now = new Date();
  const newId = `provider-op-${randomUUID()}`;

  const inserted = await tx.$queryRaw<ProviderOperationRow[]>`
    INSERT INTO "ProviderOperation" (
      "id", "kind", "subjectType", "subjectId", "idempotencyKey",
      "status", "attempts", "requestedAt", "updatedAt"
    )
    VALUES (
      ${newId}, ${input.kind}::"ProviderOperationKind", ${input.subjectType},
      ${input.subjectId}, ${input.idempotencyKey}, 'PENDING'::"ProviderOperationStatus",
      1, ${now}, ${now}
    )
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING
      "id", "kind", "subjectType", "subjectId", "idempotencyKey", "status",
      "providerObjectId", "attempts", "requestedAt", "updatedAt"
  `;

  if (inserted.length === 1) {
    return { done: false, opId: inserted[0]!.id, idempotencyKey: input.idempotencyKey };
  }

  const rows = await tx.$queryRaw<ProviderOperationRow[]>`
    SELECT
      "id", "kind", "subjectType", "subjectId", "idempotencyKey", "status",
      "providerObjectId", "attempts", "requestedAt", "updatedAt"
    FROM "ProviderOperation"
    WHERE "idempotencyKey" = ${input.idempotencyKey}
    FOR UPDATE
  `;
  const existing = rows[0];
  if (!existing) {
    throw new Error("Provider operation claim disappeared after idempotency-key conflict.");
  }
  if (!providerRowMatches(existing, input)) {
    throw new Error("Provider operation idempotency key is already bound to a different subject.");
  }

  if (existing.status === "SUCCEEDED") {
    if (!existing.providerObjectId) {
      throw new Error("Succeeded provider operation is missing its provider object id.");
    }
    return { done: true, providerObjectId: existing.providerObjectId };
  }
  if (existing.status === "SUPERSEDED") {
    throw new RetryLater("This provider operation was superseded by a newer durable decision.");
  }

  if (existing.status === "UNKNOWN") {
    if (
      expectedUnknownAttempts === undefined ||
      existing.attempts !== expectedUnknownAttempts
    ) {
      throw new RetryLater(
        "This provider operation has an unknown outcome or newer provider attempt and must be reconciled before retrying.",
      );
    }
  }
  if (existing.status === "DRIFT") {
    throw new RetryLater("This provider operation is in provider/local drift and must be reconciled before retrying.");
  }

  const updatedAtMs = new Date(existing.updatedAt).getTime();
  const ageMs = Math.max(0, now.getTime() - updatedAtMs);
  if (existing.status === "PENDING" && ageMs < staleAfterMs) {
    throw new RetryLater();
  }

  await tx.providerOperation.update({
    where: { id: existing.id },
    data: {
      status: "PENDING",
      attempts: { increment: 1 },
      completedAt: null,
      lastError: null,
    },
  });

  return { done: false, opId: existing.id, idempotencyKey: input.idempotencyKey };
}

async function finalizeExhaustedBalanceCreditHandoff(
  tx: Prisma.TransactionClient,
  operation: Pick<ProviderOperationRow, "kind" | "subjectType" | "subjectId">,
  completedAt: Date,
): Promise<void> {
  if (operation.kind !== "BALANCE_CREDIT" || operation.subjectType !== "CustomerCredit") return;

  await tx.jobBillingHandoff.updateMany({
    where: {
      kind: "PUSH_CREDIT",
      subjectId: operation.subjectId,
      status: "FAILED",
      attempts: { gte: 5 },
    },
    data: {
      status: "DONE",
      claimedAt: null,
      lastError: null,
      doneAt: completedAt,
    },
  });
}

export async function completeProviderOperation(
  tx: Prisma.TransactionClient,
  opId: string,
  result:
    | { status: "SUCCEEDED"; providerObjectId: string }
    | { status: "FAILED"; error: unknown }
    | { status: "UNKNOWN"; error?: unknown }
    | { status: "DRIFT"; providerObjectId: string; note: string },
): Promise<void> {
  const locked = await tx.$queryRaw<
    Array<{
      status: ProviderOpStatus;
      providerObjectId: string | null;
      kind: ProviderOpKind;
      subjectType: string;
      subjectId: string;
    }>
  >`
    SELECT "status", "providerObjectId", "kind", "subjectType", "subjectId"
    FROM "ProviderOperation"
    WHERE "id" = ${opId}
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) {
    throw new Error(`Provider operation ${opId} does not exist.`);
  }

  // A superseded provider result is deliberately ignored even if an old worker
  // returns late. The newer durable intent owns the provider state now.
  if (current.status === "SUPERSEDED" || current.status === "DRIFT") return;
  if (current.status === "SUCCEEDED") {
    if (result.status === "SUCCEEDED" && current.providerObjectId === result.providerObjectId) {
      await finalizeExhaustedBalanceCreditHandoff(tx, current, new Date());
      return;
    }
    if (result.status !== "DRIFT" && result.status !== "SUCCEEDED") return;
    if (result.status === "SUCCEEDED") {
      await tx.providerOperation.update({
        where: { id: opId },
        data: {
          status: "DRIFT",
          lastError: sanitizeProviderError(
            `Provider operation returned conflicting object ids: ${current.providerObjectId ?? "missing"} vs ${result.providerObjectId}.`,
          ),
          completedAt: new Date(),
        },
      });
      return;
    }
  }

  const completedAt = new Date();
  if (result.status === "SUCCEEDED") {
    await tx.providerOperation.update({
      where: { id: opId },
      data: {
        status: "SUCCEEDED",
        providerObjectId: result.providerObjectId,
        lastError: null,
        completedAt,
      },
    });
    await finalizeExhaustedBalanceCreditHandoff(tx, current, completedAt);
    return;
  }

  if (result.status === "DRIFT") {
    await tx.providerOperation.update({
      where: { id: opId },
      data: {
        status: "DRIFT",
        providerObjectId: result.providerObjectId,
        lastError: sanitizeProviderError(result.note),
        completedAt,
      },
    });
    return;
  }

  if (result.status === "UNKNOWN") {
    await tx.providerOperation.update({
      where: { id: opId },
      data: {
        status: "UNKNOWN",
        lastError: result.error === undefined ? null : sanitizeProviderError(result.error),
        completedAt: null,
      },
    });
    return;
  }

  await tx.providerOperation.update({
    where: { id: opId },
    data: {
      status: "FAILED",
      lastError: sanitizeProviderError(result.error),
      completedAt,
    },
  });
}

export async function runProviderCall<T>(
  call: () => Promise<T>,
): Promise<
  | { ok: true; value: T }
  | { ok: false; outcome: "FAILED" | "UNKNOWN"; error: unknown }
> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    const type =
      typeof error === "object" && error !== null && "type" in error
        ? String((error as { type?: unknown }).type ?? "")
        : "";
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    const name = error instanceof Error ? error.name : "";

    const ambiguous =
      type === "StripeConnectionError" ||
      type === "StripeAPIError" ||
      name === "AbortError" ||
      ["ETIMEDOUT", "ECONNRESET", "EPIPE", "ENETUNREACH", "EAI_AGAIN"].includes(code);

    return { ok: false, outcome: ambiguous ? "UNKNOWN" : "FAILED", error };
  }
}

export function sanitizeProviderError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message ?? "Unknown provider error")
          : "Unknown provider error";

  return raw
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_\-]+\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:sk|pk)_(?:live|test)\b/g, "[REDACTED_KEY]")
    .replace(/\b\d{13,19}\b/g, "[REDACTED_NUMBER]")
    .slice(0, 500);
}
