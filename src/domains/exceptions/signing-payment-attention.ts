import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { customerContact, type ExceptionItem } from "./rules";

/** Signing obligation is money owed, never payment received. */
export function signingPaymentDueItem(row: {
  agreementId: string;
  totalCents: number;
  signedAt: Date;
  customerName: string;
  latestAttempt?: { status: string; failureCode: string | null; updatedAt: Date } | null;
}): ExceptionItem {
  if (!row.agreementId || !Number.isSafeInteger(row.totalCents) || row.totalCents <= 0 ||
      !Number.isFinite(row.signedAt.getTime())) {
    throw new Error("Valid positive signing payment obligation required.");
  }
  const href = "/desk/agreements/" + encodeURIComponent(row.agreementId);
  const failed = row.latestAttempt?.status === "FAILED";
  const pending = row.latestAttempt?.status === "PENDING";
  const uncertain = ["UNKNOWN","SUCCEEDED"].includes(row.latestAttempt?.status ?? "");
  const failureAt = failed ? row.latestAttempt?.updatedAt : undefined;
  return {
    category: "SIGNING_PAYMENT_DUE",
    severity: failed || uncertain ? "high" : "medium",
    title: (failed ? "Signing payment failed — " : uncertain ? "Signing payment needs reconciliation — " : pending ? "Signing payment awaiting verification — " : "Signing payment awaiting collection — ") + row.customerName,
    detail: failed
      ? (row.latestAttempt?.failureCode === "STRIPE_ASYNC_PAYMENT_FAILED"
          ? "Stripe reported an unsuccessful asynchronous signing payment. " : "The latest signing payment attempt failed. ") +
        "Verify the provider outcome and arrange a new secure collection from the agreement; do not assume money was received or schedule delivery automatically."
      : uncertain
        ? "The provider outcome is uncertain or succeeded without a matching settled receipt. Investigate the provider-authoritative result before any new collection; an attempt is not payment."
        : pending
          ? "The signing payment attempt is pending provider verification. Reconcile its outcome before any new collection; a pending attempt is not a receipt."
          : "The agreement is signed, but the signing amount has not been recorded as paid. Arrange secure payment and verify collection before treating it as settled.",
    href,
    amountCents: row.totalCents,
    since: failureAt ?? row.signedAt,
    dueOn: failureAt,
    primaryAction: { href, label: failed ? "Investigate failed payment" : uncertain ? "Reconcile uncertain payment" : "Review signing payment" },
  };
}

/** Role-gated, bounded oldest-first read; no writes, provider calls or auto-payment. */
export async function listSigningPaymentAttention(limit: number, scope?: { customerId?: string }): Promise<{
  rows: ExceptionItem[];
  total: number;
}> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("A bounded signing payment attention limit is required.");
  }
  const where = {
    status: "AWAITING_PAYMENT",
    agreement: { status: { not: "CANCELLED" as const }, ...(scope?.customerId ? { customerId: scope.customerId } : {}) },
  };
  const rows = await prisma.agreementSigningPayment.findMany({
    where,
    select: {
      agreementId: true, totalCents: true, signedAt: true,
      attempts: { orderBy: { attemptNumber: "desc" }, take: 1,
        select: { status: true, failureCode: true, updatedAt: true } },
      agreement: { select: { customer: { select: { phone: true, user: {
        select: { name: true, email: true },
      } } } } },
    },
    orderBy: [{ signedAt: "asc" }, { agreementId: "asc" }],
    take: limit,
  });
  return {
    rows: rows.map(row => ({
      ...signingPaymentDueItem({
        agreementId: row.agreementId, totalCents: row.totalCents,
        signedAt: row.signedAt,
        latestAttempt: row.attempts?.[0] ?? null,
        customerName: row.agreement.customer.user.name ?? row.agreement.customer.user.email,
      }),
      contact: customerContact(row.agreement.customer),
    })),
    total: rows.length < limit ? rows.length :
      await prisma.agreementSigningPayment.count({ where }),
  };
}
