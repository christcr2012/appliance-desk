import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { assertCapability } from "@/domains/capabilities";
import { writeOffInvoice, writeOffInvoiceInTx } from "@/domains/billing/manual-payments";
import { postExpense, postExpenseInTx, POST_EXPENSE_TX_OPTIONS } from "@/domains/books/expenses";
import { decideDepositRefund, issueInvoiceRefund, refundHeldPayment } from "@/domains/billing/refunds";
import { applyCreditDecision, applyCreditDecisionInTx } from "@/domains/billing/money-decisions";
import { HELD_PAYMENT_STATUS } from "@/domains/billing/payment-status";

/**
 * Approval limits (Batch O-3, design D-O3).
 *
 * When the owner sets a limit, an admin who starts a write-off or posts an expense at or above it does not act: the
 * request is stored and the owner approves or declines it. Approving runs the ORIGINAL function again, as the owner,
 * inside one transaction that locks the request, so it runs once and every normal check still applies.
 * Limits start OFF. The owner's own actions never need approval.
 *
 * O-3B adds refunds, deposit decisions and credits. A credit is database-only, so it runs inside the same locked
 * transaction as the decision. A refund or deposit refund talks to Stripe, and a database transaction is never held
 * open across a Stripe call, so approving is two steps: (A) lock the request and record "approved" exactly once
 * (a second click sees "already decided"), then (B) run the original function as the owner, outside any transaction.
 * The request is only marked finished once that function returns; if it refuses, the request shows as failed with
 * the plain reason; if Stripe's answer is uncertain the existing Stripe recovery (Billing → Waiting for Stripe) owns it.
 * An approved request is NEVER re-run automatically, so a refund cannot be sent twice.
 */
export const APPROVAL_KINDS = {
  WRITE_OFF: { label: "Write off an invoice", suggestedCents: 5_000 },
  EXPENSE: { label: "Post an expense", suggestedCents: 25_000 },
  REFUND: { label: "Refund a customer (invoice, held payment or deposit)", suggestedCents: 10_000 },
  DEPOSIT_KEPT: { label: "Keep part of a deposit", suggestedCents: 10_000 },
  CREDIT: { label: "Apply a customer's credit to an invoice", suggestedCents: 10_000 },
} as const;
export type ApprovalKindBuilt = keyof typeof APPROVAL_KINDS;
export const APPROVAL_KIND_KEYS = Object.keys(APPROVAL_KINDS) as ApprovalKindBuilt[];

export type ApprovalLimits = { thresholds: Partial<Record<ApprovalKindBuilt, number>>; expiryDays: number };

export function parseApprovalThresholds(value: unknown): Partial<Record<ApprovalKindBuilt, number>> {
  const out: Partial<Record<ApprovalKindBuilt, number>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const k of APPROVAL_KIND_KEYS) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 1) out[k] = v;
  }
  return out;
}

/** Pure rule: only a non-owner, only when a limit is set, only at or above it. */
export function approvalRequired(role: string, limits: ApprovalLimits["thresholds"], kind: ApprovalKindBuilt, amountCents: number): boolean {
  if (role === "OWNER") return false;
  const limit = limits[kind];
  return limit !== undefined && amountCents >= limit;
}

export async function getApprovalLimits(): Promise<ApprovalLimits> {
  const s = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { approvalThresholds: true, approvalExpiryDays: true } });
  return { thresholds: parseApprovalThresholds(s?.approvalThresholds), expiryDays: s?.approvalExpiryDays ?? 7 };
}

export class ApprovalInputError extends Error {}

/**
 * For screens that send money back as part of a bigger action (such as an early return) and cannot wait for approval
 * in the middle. A person with a limit who is at or over it is told to ask the owner (or choose credit); the owner is never held.
 */
export async function assertRefundWithinLimit(actingUserId: string, amountCents: number): Promise<void> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  if (approvalRequired(actor.role, limits.thresholds, "REFUND", amountCents))
    throw new ApprovalInputError(`A refund of ${dollars(amountCents)} is over your refund limit. Ask the owner to finish this, or give the customer credit instead.`);
}

/** Owner only. `limitsCents` omitted or null for a kind = no approval needed for it. */
export async function saveApprovalLimits(ownerId: string, input: { limitsCents: Partial<Record<ApprovalKindBuilt, number | null>>; expiryDays: number }) {
  if (!Number.isSafeInteger(input.expiryDays) || input.expiryDays < 1 || input.expiryDays > 30)
    throw new ApprovalInputError("Requests can wait between 1 and 30 days.");
  const next: Partial<Record<ApprovalKindBuilt, number>> = {};
  for (const k of APPROVAL_KIND_KEYS) {
    const v = input.limitsCents[k];
    if (v === null || v === undefined) continue;
    if (!Number.isSafeInteger(v) || v < 100 || v > 100_000_000) throw new ApprovalInputError("A limit must be between $1.00 and $1,000,000.00, or left blank for no limit.");
    next[k] = v;
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { approvalThresholds: true, approvalExpiryDays: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { approvalThresholds: next, approvalExpiryDays: input.expiryDays } });
    await tx.auditLog.create({
      data: {
        userId: ownerId, action: "settings.approval_limits", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { thresholds: parseApprovalThresholds(before.approvalThresholds), expiryDays: before.approvalExpiryDays },
        newValue: { thresholds: next, expiryDays: input.expiryDays },
      },
    });
  });
}

export type SubmitResult = { status: "DONE"; providerOpId?: string | null; heldRefundOutcome?: "SUCCEEDED" | "FAILED" | "UNKNOWN" } | { status: "SENT_FOR_APPROVAL" | "ALREADY_WAITING"; message: string; requestId: string };

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

async function actorRole(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true, name: true, email: true } });
  if (!u || u.archivedAt) throw new Error("This account no longer has access to make that change.");
  return u;
}

async function storeRequest(kind: ApprovalKindBuilt, args: { targetRef: string; input: Prisma.InputJsonObject; amountCents: number; summary: string; requestedBy: string; expiryDays: number }): Promise<SubmitResult> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.approvalRequest.create({
        data: {
          kind, targetRef: args.targetRef, input: args.input, amountCents: args.amountCents, summary: args.summary,
          requestedByUserId: args.requestedBy, expiresAt: new Date(Date.now() + args.expiryDays * 86_400_000),
        },
      });
      await tx.auditLog.create({
        data: { userId: args.requestedBy, action: "approval.requested", entityType: "ApprovalRequest", entityId: created.id, newValue: { kind, amountCents: args.amountCents, targetRef: args.targetRef } },
      });
      return created;
    });
    return { status: "SENT_FOR_APPROVAL", requestId: row.id, message: "Sent to the owner for approval. Nothing has changed yet." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.approvalRequest.findFirst({ where: { kind, targetRef: args.targetRef, status: "PENDING" } });
      if (existing) return { status: "ALREADY_WAITING", requestId: existing.id, message: "This is already waiting for the owner's approval." };
    }
    throw e;
  }
}

/** Entry point for the write-off button: acts at once, or sends the request to the owner when it is at or above the limit. */
export async function submitWriteOff(actingUserId: string, invoiceId: string, reason: string): Promise<SubmitResult> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, amountDueCents: true, amountPaidCents: true } });
  if (!invoice) throw new Error("Couldn't find that invoice.");
  const outstanding = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  if (!approvalRequired(actor.role, limits.thresholds, "WRITE_OFF", outstanding)) {
    await writeOffInvoice(invoiceId, actingUserId, reason);
    return { status: "DONE" };
  }
  await prisma.$transaction((tx) => assertCapability(tx, actingUserId, "WRITE_OFF")); // a limited admin cannot even ask
  return storeRequest("WRITE_OFF", {
    targetRef: invoiceId, input: { invoiceId, reason }, amountCents: outstanding, requestedBy: actingUserId, expiryDays: limits.expiryDays,
    summary: `Write off invoice #${invoice.invoiceNumber} (${dollars(outstanding)} unpaid). Reason given: ${reason}`,
  });
}

/** Entry point for posting an expense. */
export async function submitExpensePost(actingUserId: string, expenseId: string, version: number): Promise<SubmitResult> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  const expense = await prisma.expense.findUnique({ where: { id: expenseId }, select: { id: true, amountCents: true, vendorName: true, memo: true } });
  if (!expense) throw new Error("Couldn't find that expense.");
  if (!approvalRequired(actor.role, limits.thresholds, "EXPENSE", expense.amountCents)) {
    await postExpense(actingUserId, expenseId, version);
    return { status: "DONE" };
  }
  await prisma.$transaction((tx) => assertCapability(tx, actingUserId, "POST_EXPENSES"));
  return storeRequest("EXPENSE", {
    targetRef: expenseId, input: { expenseId, version }, amountCents: expense.amountCents, requestedBy: actingUserId, expiryDays: limits.expiryDays,
    summary: `Post an expense of ${dollars(expense.amountCents)}${expense.vendorName ? ` to ${expense.vendorName}` : ""}${expense.memo ? ` (${expense.memo})` : ""}`,
  });
}

const REFUND_REASONS = ["OVERPAYMENT", "BILLING_ERROR", "GOODWILL", "DISPUTE_RESOLUTION", "OTHER"] as const;
export type InvoiceRefundReason = (typeof REFUND_REASONS)[number];

/** Refund part or all of what was paid on one invoice: acts at once, or waits for the owner at or above the limit. */
export async function submitInvoiceRefund(actingUserId: string, input: { invoiceId: string; amountCents: number; reason: InvoiceRefundReason; notes: string }): Promise<SubmitResult> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  if (!approvalRequired(actor.role, limits.thresholds, "REFUND", input.amountCents)) {
    const r = await issueInvoiceRefund(actingUserId, input);
    return { status: "DONE", providerOpId: r.providerOpId };
  }
  await prisma.$transaction((tx) => assertCapability(tx, actingUserId, "ISSUE_REFUND"));
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, select: { invoiceNumber: true } });
  if (!invoice) throw new Error("Couldn't find that invoice.");
  return storeRequest("REFUND", {
    targetRef: `invoice:${input.invoiceId}:${input.amountCents}`,
    input: { action: "invoice_refund", invoiceId: input.invoiceId, amountCents: input.amountCents, reason: input.reason, notes: input.notes },
    amountCents: input.amountCents, requestedBy: actingUserId, expiryDays: limits.expiryDays,
    summary: `Refund ${dollars(input.amountCents)} on invoice #${invoice.invoiceNumber}. Reason given: ${input.notes}`,
  });
}

/** Send a held payment back to the customer's card. */
export async function submitHeldPaymentRefund(actingUserId: string, paymentId: string): Promise<SubmitResult> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { amountCents: true, status: true, invoice: { select: { invoiceNumber: true } } } });
  if (!payment) throw new Error("Couldn't find that held payment.");
  if (!approvalRequired(actor.role, limits.thresholds, "REFUND", payment.amountCents)) {
    const r = await refundHeldPayment(actingUserId, paymentId);
    return { status: "DONE", providerOpId: r.providerOpId || null, heldRefundOutcome: r.outcome };
  }
  if (payment.status !== HELD_PAYMENT_STATUS) throw new Error("This payment has already been dealt with.");
  await prisma.$transaction((tx) => assertCapability(tx, actingUserId, "ISSUE_REFUND"));
  return storeRequest("REFUND", {
    targetRef: `held:${paymentId}`, input: { action: "held_refund", paymentId }, amountCents: payment.amountCents, requestedBy: actingUserId, expiryDays: limits.expiryDays,
    summary: `Send a held payment of ${dollars(payment.amountCents)} (invoice #${payment.invoice.invoiceNumber}) back to the customer's card`,
  });
}

/** Decide what to give back of a deposit. Keeping money needs the "keep part of a deposit" limit; a large refund needs the refund limit. */
export async function submitDepositDecision(actingUserId: string, input: { depositId: string; refundCents: number; deductionReason?: string }): Promise<SubmitResult> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId }, select: { amountCents: true } });
  if (!deposit) throw new Error("Couldn't find that deposit.");
  const keptCents = Math.max(0, deposit.amountCents - input.refundCents);
  const kind: ApprovalKindBuilt | null = approvalRequired(actor.role, limits.thresholds, "DEPOSIT_KEPT", keptCents) ? "DEPOSIT_KEPT"
    : approvalRequired(actor.role, limits.thresholds, "REFUND", input.refundCents) ? "REFUND" : null;
  if (!kind) {
    const r = await decideDepositRefund(actingUserId, input);
    return { status: "DONE", providerOpId: r.providerOpId };
  }
  await prisma.$transaction((tx) => assertCapability(tx, actingUserId, "REFUND_DEPOSIT"));
  return storeRequest(kind, {
    targetRef: `deposit:${input.depositId}`,
    input: { action: "deposit", depositId: input.depositId, refundCents: input.refundCents, deductionReason: input.deductionReason ?? null },
    amountCents: kind === "DEPOSIT_KEPT" ? keptCents : input.refundCents, requestedBy: actingUserId, expiryDays: limits.expiryDays,
    summary: `Deposit decision: give back ${dollars(input.refundCents)} and keep ${dollars(keptCents)} of a ${dollars(deposit.amountCents)} deposit${input.deductionReason ? `. Reason given: ${input.deductionReason}` : ""}`,
  });
}

/** Use a customer's account credit on an open invoice. */
export async function submitCreditApply(actingUserId: string, input: { creditId: string; invoiceId: string; amountCents: number }): Promise<SubmitResult> {
  const actor = await actorRole(actingUserId);
  const limits = await getApprovalLimits();
  if (!approvalRequired(actor.role, limits.thresholds, "CREDIT", input.amountCents)) {
    await applyCreditDecision(actingUserId, input);
    return { status: "DONE" };
  }
  await prisma.$transaction((tx) => assertActiveTeamActor(tx, actingUserId, ["OWNER", "ADMIN"]));
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, select: { invoiceNumber: true } });
  if (!invoice) throw new Error("Couldn't find that invoice.");
  return storeRequest("CREDIT", {
    targetRef: `credit:${input.creditId}:${input.invoiceId}`, input: { action: "credit", ...input }, amountCents: input.amountCents, requestedBy: actingUserId, expiryDays: limits.expiryDays,
    summary: `Apply ${dollars(input.amountCents)} of a customer's credit to invoice #${invoice.invoiceNumber}`,
  });
}

/** Plain words for where a Stripe step stands, from the saved record (never a guess). */
export async function describeProviderOperation(providerOpId: string | null | undefined): Promise<string> {
  if (!providerOpId) return "No Stripe step was needed (the money was not paid through Stripe, so you pay it back yourself and it is recorded).";
  const op = await prisma.providerOperation.findUnique({ where: { id: providerOpId }, select: { status: true } });
  return PROVIDER_STATE_WORDS[op?.status ?? "PENDING"] ?? "Recorded.";
}

export type DecisionResult =
  | { status: "APPROVED"; message: string; /** What the money side confirmed. Absent means done (non-money kinds). */ state?: "DONE" | "WAITING" | "UNCERTAIN" }
  | { status: "DECLINED" | "EXPIRED" | "FAILED"; message: string };

class RunFailure extends Error {}

export async function decideApproval(ownerId: string, requestId: string, decision: "APPROVE" | "DECLINE", note?: string): Promise<DecisionResult> {
  const cleanNote = note?.trim().slice(0, 300) || null;
  let phaseB: { req: { kind: string; input: unknown; targetRef: string }; who: string } | null = null;
  let result: DecisionResult;
  try {
    result = await prisma.$transaction(async (tx): Promise<DecisionResult> => {
      await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
      if (!req) throw new ApprovalInputError("That request no longer exists.");
      if (req.status !== "PENDING") throw new ApprovalInputError("This request was already decided.");
      const now = new Date();
      const audit = (action: string, extra: Prisma.InputJsonObject) =>
        tx.auditLog.create({ data: { userId: ownerId, action, entityType: "ApprovalRequest", entityId: requestId, newValue: { kind: req.kind, requestedByUserId: req.requestedByUserId, ...extra } } });
      if (req.expiresAt < now) {
        await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "EXPIRED", decidedAt: now } });
        await audit("approval.expired", {});
        return { status: "EXPIRED", message: "This request waited too long and has expired. Ask for it again if it is still needed." };
      }
      if (decision === "DECLINE") {
        await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "DECLINED", decidedByUserId: ownerId, decidedAt: now, decisionNote: cleanNote } });
        await audit("approval.declined", { note: cleanNote });
        return { status: "DECLINED", message: "Declined. Nothing was changed." };
      }
      const requester = await tx.user.findUnique({ where: { id: req.requestedByUserId }, select: { name: true, email: true } });
      const who = requester?.name || requester?.email || "an admin";
      const input = req.input as Record<string, unknown>;
      const resultRef = req.targetRef;
      if (req.kind === "REFUND" || req.kind === "DEPOSIT_KEPT") {
        // Step A: record the approval once, under the lock. The Stripe-backed work happens after this commits.
        await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "APPROVED", decidedByUserId: ownerId, decidedAt: now, decisionNote: cleanNote } });
        await audit("approval.approved", { note: cleanNote });
        phaseB = { req: { kind: req.kind, input: req.input, targetRef: req.targetRef }, who };
        return { status: "APPROVED", message: "Approved." };
      }
      try {
        if (req.kind === "CREDIT") {
          await applyCreditDecisionInTx(tx, ownerId, { creditId: String(input.creditId), invoiceId: String(input.invoiceId), amountCents: Number(input.amountCents) });
        } else if (req.kind === "WRITE_OFF") {
          await writeOffInvoiceInTx(tx, String(input.invoiceId), ownerId, `${String(input.reason)} (requested by ${who}, approved by the owner)`);
        } else if (req.kind === "EXPENSE") {
          await postExpenseInTx(tx, ownerId, String(input.expenseId), Number(input.version));
        } else {
          throw new RunFailure("This kind of request cannot be approved yet.");
        }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError) throw e; // a database problem is retried, not recorded as a business failure
        throw new RunFailure(e instanceof Error ? e.message : "It could not be done.");
      }
      await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "APPROVED", decidedByUserId: ownerId, decidedAt: now, decisionNote: cleanNote, executedAt: now, resultRef } });
      await audit("approval.executed", { resultRef, note: cleanNote });
      return { status: "APPROVED", message: "Approved and done." };
    }, POST_EXPENSE_TX_OPTIONS);
  } catch (e) {
    if (e instanceof RunFailure) {
      // The action itself was refused (for example the invoice was paid in the meantime). Record that, once.
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
        const r = await tx.approvalRequest.findUnique({ where: { id: requestId }, select: { status: true } });
        if (r?.status !== "PENDING") return;
        await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "FAILED", decidedByUserId: ownerId, decidedAt: new Date(), failureMessage: e.message.slice(0, 300) } });
        await tx.auditLog.create({ data: { userId: ownerId, action: "approval.failed", entityType: "ApprovalRequest", entityId: requestId, newValue: { message: e.message.slice(0, 300) } } });
      });
      return { status: "FAILED", message: `Approved, but it could not be done: ${e.message} Nothing was changed.` };
    }
    throw e;
  }
  const pending = phaseB as { req: { kind: string; input: unknown; targetRef: string }; who: string } | null;
  if (!pending) return result;
  return runApprovedStripeWork(ownerId, requestId, pending.req.input as Record<string, unknown>, pending.who, pending.req.targetRef);
}

function plainFailure(e: unknown): string {
  const text = e instanceof Error ? e.message : "";
  if (text && text.length < 260 && !/prisma|SQL|constraint|\bat\s/i.test(text)) return text;
  return "It could not be done.";
}

/** Plain words for the saved state of an approved Stripe-backed request, from the provider record (never a guess). */
const PROVIDER_STATE_WORDS: Record<string, string> = {
  PENDING: "Stripe has been asked and has not confirmed yet. It is retried automatically; check Billing → Waiting for Stripe.",
  SUCCEEDED: "Stripe confirmed the refund.",
  FAILED: "Stripe refused it. See Billing → Waiting for Stripe for the reason.",
  UNKNOWN: "We did not get an answer from Stripe. Do not repeat it; see Billing → Waiting for Stripe.",
};
const APPROVAL_TOKEN = (requestId: string) => `[approval ${requestId}]`;
/** How long an approved request may sit with no sign of the refund before the owner may ask for it to be checked and finished. */
const RECOVERY_AFTER_MS = 120_000;

/**
 * Step B of approving a refund or deposit decision: run the original function as the owner, outside any transaction.
 * The request is marked finished ONLY when the money side is confirmed (Stripe succeeded, or no Stripe step was needed).
 * Otherwise it stays "approved, not finished" and points at the provider record, which the Stripe recovery pass owns.
 */
async function runApprovedStripeWork(ownerId: string, requestId: string, input: Record<string, unknown>, who: string, targetRef: string): Promise<DecisionResult> {
  const suffix = ` (requested by ${who}, approved by the owner)`;
  try {
    let opId: string | null;
    if (input.action === "invoice_refund") {
      const r = await issueInvoiceRefund(ownerId, {
        invoiceId: String(input.invoiceId), amountCents: Number(input.amountCents), reason: input.reason as InvoiceRefundReason,
        notes: `${APPROVAL_TOKEN(requestId)} ${String(input.notes)}${suffix}`.slice(0, 500),
        approvalMarker: APPROVAL_TOKEN(requestId),
      });
      // If a parallel run of this same approval already made the refund, the saved Stripe record is the truth.
      opId = r.providerOpId ?? (await prisma.providerOperation.findFirst({ where: { subjectType: "Refund", subjectId: r.refundId, kind: "REFUND_CREATE" }, select: { id: true } }))?.id ?? null;
    } else if (input.action === "held_refund") {
      const r = await refundHeldPayment(ownerId, String(input.paymentId));
      opId = r.providerOpId || null;
    } else if (input.action === "deposit") {
      const r = await decideDepositRefund(ownerId, {
        depositId: String(input.depositId), refundCents: Number(input.refundCents),
        deductionReason: typeof input.deductionReason === "string" && input.deductionReason ? input.deductionReason : undefined,
      });
      opId = r.providerOpId;
    } else {
      throw new Error("This kind of request cannot be approved yet.");
    }
    return await settleApprovedWork(ownerId, requestId, opId, targetRef);
  } catch (e) {
    const message = plainFailure(e);
    if (await workAlreadyStarted(input, requestId)) {
      // Money may already be on its way; the failure was in recording it. Keep the request recoverable, never say "nothing was sent".
      return { status: "APPROVED", state: "UNCERTAIN", message: "Approved, but we could not confirm what happened. Money may already have been sent, so do not repeat it. Use Check and finish in two minutes, or see Billing → Waiting for Stripe." };
    }
    await prisma.$transaction(async (tx) => {
      await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "FAILED", failureMessage: message.slice(0, 300) } });
      await tx.auditLog.create({ data: { userId: ownerId, action: "approval.failed", entityType: "ApprovalRequest", entityId: requestId, newValue: { message: message.slice(0, 300) } } });
    });
    return { status: "FAILED", message: `Approved, but it could not be done: ${message} If a Stripe step had already started it shows under Billing → Waiting for Stripe; do not repeat it.` };
  }
}

/** True when the saved records show this approval's money step has already begun (so it must never be marked "nothing was sent"). */
async function workAlreadyStarted(input: Record<string, unknown>, requestId: string): Promise<boolean> {
  try {
    if (input.action === "invoice_refund") {
      return !!(await prisma.refund.findFirst({ where: { invoiceId: String(input.invoiceId), notes: { contains: APPROVAL_TOKEN(requestId) } }, select: { id: true } }));
    }
    if (input.action === "deposit") {
      return !!(await prisma.deposit.findFirst({ where: { id: String(input.depositId), refundedAt: { not: null } }, select: { id: true } }));
    }
    if (input.action === "held_refund") {
      const pay = await prisma.payment.findUnique({ where: { id: String(input.paymentId) }, select: { status: true } });
      return !!pay && pay.status !== HELD_PAYMENT_STATUS;
    }
  } catch {
    return true; // cannot tell: the safe answer is "it may have started"
  }
  return false;
}

/** Record where the money side stands. Finished only on a confirmed result; otherwise remember the provider record. */
async function settleApprovedWork(ownerId: string, requestId: string, opId: string | null, targetRef: string): Promise<DecisionResult> {
  const op = opId ? await prisma.providerOperation.findUnique({ where: { id: opId }, select: { status: true } }) : null;
  const confirmed = !opId || op?.status === "SUCCEEDED";
  const state = !opId ? "No Stripe step was needed (the money was not paid through Stripe, so you pay it back yourself and it is recorded)." : PROVIDER_STATE_WORDS[op?.status ?? "PENDING"] ?? "Recorded.";
  await prisma.$transaction(async (tx) => {
    await tx.approvalRequest.update({ where: { id: requestId }, data: confirmed ? { executedAt: new Date(), resultRef: targetRef } : { resultRef: `op:${opId}` } });
    await tx.auditLog.create({ data: { userId: ownerId, action: confirmed ? "approval.executed" : "approval.waiting_on_provider", entityType: "ApprovalRequest", entityId: requestId, newValue: { resultRef: confirmed ? targetRef : `op:${opId}`, state } } });
  });
  return { status: "APPROVED", state: confirmed ? "DONE" : "WAITING", message: confirmed ? `Approved and done. ${state}` : `Approved, but not finished yet. ${state}` };
}

/**
 * Owner only. An approved refund or deposit request that shows no sign of work (the server stopped between "approved" and
 * "sent") can be checked and finished. It first looks for the refund this approval would have made (its marker is in the
 * refund's notes, or the deposit/held payment already changed) so it can never send the same money twice.
 */
export async function finishApprovedRequest(ownerId: string, requestId: string): Promise<DecisionResult> {
  const claimed = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new ApprovalInputError("That request no longer exists.");
    if (req.status !== "APPROVED" || req.executedAt || req.resultRef?.startsWith("op:")) throw new ApprovalInputError("Nothing is waiting to be finished on this request.");
    if (!req.decidedAt || Date.now() - req.decidedAt.getTime() < RECOVERY_AFTER_MS) throw new ApprovalInputError("This was approved moments ago and may still be running. Wait two minutes and check again.");
    const requester = await tx.user.findUnique({ where: { id: req.requestedByUserId }, select: { name: true, email: true } });
    // Push the clock so two clicks cannot both start recovery.
    await tx.approvalRequest.update({ where: { id: requestId }, data: { decidedAt: new Date() } });
    return { input: req.input as Record<string, unknown>, targetRef: req.targetRef, who: requester?.name || requester?.email || "an admin" };
  });
  if (claimed.input.action === "invoice_refund") {
    const made = await prisma.refund.findFirst({ where: { invoiceId: String(claimed.input.invoiceId), notes: { contains: APPROVAL_TOKEN(requestId) } }, select: { id: true } });
    if (made) {
      const op = await prisma.providerOperation.findFirst({ where: { subjectType: "Refund", subjectId: made.id, kind: "REFUND_CREATE" }, select: { id: true } });
      return settleApprovedWork(ownerId, requestId, op?.id ?? null, claimed.targetRef);
    }
  } else if (claimed.input.action === "deposit") {
    const dep = await prisma.deposit.findUnique({ where: { id: String(claimed.input.depositId) }, select: { refundedAt: true, refundedAmountCents: true, deductionReason: true } });
    if (dep?.refundedAt) {
      const wantReason = typeof claimed.input.deductionReason === "string" && claimed.input.deductionReason ? claimed.input.deductionReason.trim() : null;
      if (dep.refundedAmountCents !== Number(claimed.input.refundCents) || (dep.deductionReason ?? null) !== wantReason) {
        const message = "That deposit was settled a different way (a different amount or reason) before this approval went out, so this approval was not carried out.";
        await prisma.$transaction(async (tx) => {
          await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "FAILED", failureMessage: message } });
          await tx.auditLog.create({ data: { userId: ownerId, action: "approval.failed", entityType: "ApprovalRequest", entityId: requestId, newValue: { message } } });
        });
        return { status: "FAILED", message };
      }
      const op = await prisma.providerOperation.findFirst({ where: { subjectType: "Deposit", subjectId: String(claimed.input.depositId), kind: "REFUND_CREATE" }, select: { id: true } });
      return settleApprovedWork(ownerId, requestId, op?.id ?? null, claimed.targetRef);
    }
  } else if (claimed.input.action === "held_refund") {
    const paymentId = String(claimed.input.paymentId);
    const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
    if (pay && pay.status !== HELD_PAYMENT_STATUS) {
      // The refund for THIS payment is named in the audit row written when it was sent back; anything else means the
      // payment was dealt with another way (credit, marked paid) and no money went back to the card.
      const sent = await prisma.auditLog.findFirst({ where: { action: "billing.held_payment_refunded", entityType: "Payment", entityId: paymentId }, select: { newValue: true } });
      const refundId = (sent?.newValue as { refundId?: string } | null)?.refundId;
      if (!refundId) {
        const message = "That held payment was dealt with another way (turned into credit or marked paid) before the refund went out, so nothing was sent to the card.";
        await prisma.$transaction(async (tx) => {
          await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "FAILED", failureMessage: message } });
          await tx.auditLog.create({ data: { userId: ownerId, action: "approval.failed", entityType: "ApprovalRequest", entityId: requestId, newValue: { message } } });
        });
        return { status: "FAILED", message };
      }
      const op = await prisma.providerOperation.findFirst({ where: { subjectType: "Refund", subjectId: refundId, kind: "REFUND_CREATE" }, select: { id: true } });
      return settleApprovedWork(ownerId, requestId, op?.id ?? null, claimed.targetRef);
    }
  }
  return runApprovedStripeWork(ownerId, requestId, claimed.input, claimed.who, claimed.targetRef);
}

export type ApprovalRow = {
  id: string; kind: ApprovalKindBuilt | string; summary: string; amountCents: number; requestedBy: string; createdAt: Date;
  expiresAt: Date; status: string; expired: boolean; decisionNote: string | null; failureMessage: string | null; decidedAt: Date | null; finished: boolean;
  /** For an approved refund/deposit: where the Stripe side stands, in plain words. */
  stateNote: string | null;
  /** True when an approved request shows no sign of work and the owner may ask for it to be checked and finished. */
  canFinish: boolean;
};

async function rows(where: Prisma.ApprovalRequestWhereInput, take: number): Promise<ApprovalRow[]> {
  const list = await prisma.approvalRequest.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(list.map((r) => r.requestedByUserId))] } }, select: { id: true, name: true, email: true } });
  const opIds = list.map((r) => r.resultRef).filter((x): x is string => !!x && x.startsWith("op:")).map((x) => x.slice(3));
  const ops = opIds.length ? await prisma.providerOperation.findMany({ where: { id: { in: opIds } }, select: { id: true, status: true } }) : [];
  const now = Date.now();
  return list.map((r) => {
    const opStatus = r.resultRef?.startsWith("op:") ? ops.find((o) => o.id === r.resultRef!.slice(3))?.status : undefined;
    const waitingOnStripe = r.status === "APPROVED" && !r.executedAt && opStatus !== undefined;
    return {
      id: r.id, kind: r.kind, summary: r.summary, amountCents: r.amountCents, createdAt: r.createdAt, expiresAt: r.expiresAt, status: r.status,
      requestedBy: (users.find((u) => u.id === r.requestedByUserId)?.name ?? users.find((u) => u.id === r.requestedByUserId)?.email) || "An admin",
      expired: r.status === "PENDING" && r.expiresAt.getTime() < now, decisionNote: r.decisionNote, failureMessage: r.failureMessage, decidedAt: r.decidedAt,
      finished: r.executedAt !== null || opStatus === "SUCCEEDED",
      stateNote: waitingOnStripe ? PROVIDER_STATE_WORDS[opStatus!] ?? null : null,
      canFinish: r.status === "APPROVED" && !r.executedAt && !r.resultRef?.startsWith("op:") && !!r.decidedAt && now - r.decidedAt.getTime() >= RECOVERY_AFTER_MS && (r.kind === "REFUND" || r.kind === "DEPOSIT_KEPT"),
    };
  });
}
export const listWaitingApprovals = () => rows({ status: "PENDING" }, 50);
export async function listDecidedApprovals() {
  const list = await rows({ status: { not: "PENDING" } }, 200);
  return list.reverse().slice(0, 20);
}
/** For the one Today item. Expired requests are not counted (nothing can be done with them). */
export async function countWaitingApprovals(now = new Date()) {
  return prisma.approvalRequest.count({ where: { status: "PENDING", expiresAt: { gte: now } } });
}
