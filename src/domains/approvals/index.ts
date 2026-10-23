import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { assertCapability } from "@/domains/capabilities";
import { writeOffInvoice, writeOffInvoiceInTx } from "@/domains/billing/manual-payments";
import { postExpense, postExpenseInTx, POST_EXPENSE_TX_OPTIONS } from "@/domains/books/expenses";

/**
 * Approval limits (Batch O-3, design D-O3).
 *
 * When the owner sets a limit, an admin who starts a write-off or posts an expense at or above it does not act: the
 * request is stored and the owner approves or declines it. Approving runs the ORIGINAL function again, as the owner,
 * inside one transaction that locks the request, so it runs once and every normal check still applies.
 * Limits start OFF. The owner's own actions never need approval. Refunds, credits and deposit decisions talk to Stripe
 * and are not covered yet (design stop rule S-O2; see docs/designs/O-3B-STRONGER-MODEL-PROMPT.md).
 */
export const APPROVAL_KINDS = {
  WRITE_OFF: { label: "Write off an invoice", suggestedCents: 5_000 },
  EXPENSE: { label: "Post an expense", suggestedCents: 25_000 },
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

export type SubmitResult = { status: "DONE" } | { status: "SENT_FOR_APPROVAL" | "ALREADY_WAITING"; message: string; requestId: string };

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

export type DecisionResult =
  | { status: "APPROVED"; message: string }
  | { status: "DECLINED" | "EXPIRED" | "FAILED"; message: string };

class RunFailure extends Error {}

export async function decideApproval(ownerId: string, requestId: string, decision: "APPROVE" | "DECLINE", note?: string): Promise<DecisionResult> {
  const cleanNote = note?.trim().slice(0, 300) || null;
  try {
    return await prisma.$transaction(async (tx): Promise<DecisionResult> => {
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
      try {
        if (req.kind === "WRITE_OFF") {
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
}

export type ApprovalRow = {
  id: string; kind: ApprovalKindBuilt | string; summary: string; amountCents: number; requestedBy: string; createdAt: Date;
  expiresAt: Date; status: string; expired: boolean; decisionNote: string | null; failureMessage: string | null; decidedAt: Date | null;
};

async function rows(where: Prisma.ApprovalRequestWhereInput, take: number): Promise<ApprovalRow[]> {
  const list = await prisma.approvalRequest.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(list.map((r) => r.requestedByUserId))] } }, select: { id: true, name: true, email: true } });
  const now = Date.now();
  return list.map((r) => ({
    id: r.id, kind: r.kind, summary: r.summary, amountCents: r.amountCents, createdAt: r.createdAt, expiresAt: r.expiresAt, status: r.status,
    requestedBy: (users.find((u) => u.id === r.requestedByUserId)?.name ?? users.find((u) => u.id === r.requestedByUserId)?.email) || "An admin",
    expired: r.status === "PENDING" && r.expiresAt.getTime() < now, decisionNote: r.decisionNote, failureMessage: r.failureMessage, decidedAt: r.decidedAt,
  }));
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
