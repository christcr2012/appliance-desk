import { prisma } from "@/lib/prisma";

/**
 * Things the system has asked Stripe to do that are not finished (docs/designs/BATCH-D.md D5). Read-only: nothing here
 * retries anything; the nightly pass does that, and the reconciliation workbench shows differences.
 */

const KIND_LABEL: Record<string, string> = {
  CUSTOMER_CREATE: "Creating the customer at Stripe",
  SUBSCRIPTION_CREATE: "Starting the monthly billing",
  SUBSCRIPTION_CANCEL: "Stopping the monthly billing",
  SUBSCRIPTION_UPDATE: "Changing the monthly billing",
  BALANCE_CREDIT: "Giving the customer a credit at Stripe",
  REFUND_CREATE: "Refunding money to the customer's card or bank",
};

const STATUS_MEANING: Record<string, string> = {
  PENDING: "Sent or about to be sent, and Stripe has not confirmed yet. It is retried automatically.",
  UNKNOWN: "We did not get an answer, so we cannot tell whether Stripe did it. Check Stripe before anyone repeats it.",
  FAILED: "Stripe refused it. A person needs to look at the reason below.",
};

export type WaitingOperation = {
  id: string;
  what: string;
  meaning: string;
  status: string;
  subject: string;
  since: Date;
  attempts: number;
  lastError: string | null;
};

export type WaitingEnding = {
  stripeSubscriptionId: string;
  agreementId: string;
  what: string;
  attempts: number;
  lastError: string | null;
  since: Date;
};

export function describeOperation(op: {
  id: string;
  kind: string;
  status: string;
  subjectType: string;
  subjectId: string;
  requestedAt: Date;
  attempts: number;
  lastError: string | null;
}): WaitingOperation {
  return {
    id: op.id,
    what: KIND_LABEL[op.kind] ?? "A Stripe request",
    meaning: STATUS_MEANING[op.status] ?? "Not finished.",
    status: op.status,
    subject: `${op.subjectType} ${op.subjectId}`,
    since: op.requestedAt,
    attempts: op.attempts,
    lastError: op.lastError,
  };
}

export async function getWaitingForStripe(limit = 100) {
  const [operations, endings, operationCount] = await Promise.all([
    prisma.providerOperation.findMany({
      where: { status: { in: ["PENDING", "UNKNOWN", "FAILED"] } },
      orderBy: { requestedAt: "asc" },
      take: limit,
    }),
    prisma.$queryRaw<
      Array<{ stripeSubscriptionId: string; holderAgreementId: string; mode: string; attempts: number; lastError: string | null; createdAt: Date }>
    >`
      SELECT "stripeSubscriptionId", "holderAgreementId", "mode"::text AS "mode", "attempts", "lastError", "updatedAt" AS "createdAt"
      FROM "SubscriptionEndIntent"
      WHERE "appliedVersion" < "version"
      ORDER BY "updatedAt" ASC
      LIMIT ${limit}
    `,
    prisma.providerOperation.count({ where: { status: { in: ["PENDING", "UNKNOWN", "FAILED"] } } }),
  ]);
  return {
    operations: operations.map(describeOperation),
    operationCount,
    endings: endings.map<WaitingEnding>((e) => ({
      stripeSubscriptionId: e.stripeSubscriptionId,
      agreementId: e.holderAgreementId,
      what:
        e.mode === "CLOSED"
          ? "Closing the monthly billing for a rental that ended"
          : e.mode === "END_AT"
            ? "Setting the date the monthly billing stops"
            : "Taking the stop date off the monthly billing",
      attempts: e.attempts,
      lastError: e.lastError,
      since: e.createdAt,
    })),
  };
}
