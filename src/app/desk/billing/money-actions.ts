"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decideDepositRefund, issueInvoiceRefund } from "@/domains/billing/refunds";
import { applyCreditDecision } from "@/domains/billing/money-decisions";

export type MoneyActionState = { status: "success"; message: string } | { status: "error"; message: string };

const KNOWN_ERRORS = [
  "Refund amount",
  "Credit amount",
  "refund",
  "Refund",
  "deposit",
  "Deposit",
  "credit",
  "Credit",
  "invoice",
  "Couldn't find",
  "no longer has access",
  "reason",
];

function plainError(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  // The money functions throw plain-English sentences; show those, never a stack trace or database text.
  if (text && text.length < 260 && KNOWN_ERRORS.some((k) => text.includes(k)) && !/prisma|SQL|constraint|\bat\s/i.test(text)) return text;
  return "That could not be done. Nothing was changed. Check the amounts and try again.";
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

async function operationState(providerOpId: string | null): Promise<string> {
  if (!providerOpId) return "No Stripe step was needed (the money was not paid through Stripe, so you pay it back yourself and it is recorded).";
  const op = await prisma.providerOperation.findUnique({ where: { id: providerOpId }, select: { status: true } });
  const labels: Record<string, string> = {
    PENDING: "Stripe has been asked and has not confirmed yet. It is retried automatically; check Billing → Waiting for Stripe.",
    SUCCEEDED: "Stripe confirmed the refund.",
    FAILED: "Stripe refused it. See Billing → Waiting for Stripe for the reason.",
    UNKNOWN: "We did not get an answer from Stripe. Do not repeat it; see Billing → Waiting for Stripe.",
  };
  return labels[op?.status ?? "PENDING"] ?? "Recorded.";
}

/** Decide what to give back of a deposit (owner/admin). A partial refund needs a written reason. */
export async function decideDepositAction(
  depositId: string,
  input: { amountCents: number; reason: string; confirmed: boolean },
): Promise<MoneyActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const cents = whole(input.amountCents);
  if (!cents) return { status: "error", message: "Enter an amount greater than $0.00." };
  if (input.confirmed !== true) return { status: "error", message: "Tick the confirmation box to continue." };
  try {
    const result = await decideDepositRefund(session.user.id, {
      depositId,
      refundCents: cents,
      deductionReason: input.reason?.trim() || undefined,
    });
    revalidatePath("/desk/billing");
    return { status: "success", message: `Deposit decision recorded. ${await operationState(result.providerOpId)}` };
  } catch (error) {
    return { status: "error", message: plainError(error) };
  }
}

const REASONS = ["OVERPAYMENT", "BILLING_ERROR", "GOODWILL", "DISPUTE_RESOLUTION", "OTHER"] as const;

/** Refund part or all of what a customer paid on one invoice (owner/admin). */
export async function refundInvoiceAction(
  invoiceId: string,
  input: { amountCents: number; reason: string; select: string; confirmed: boolean },
): Promise<MoneyActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const cents = whole(input.amountCents);
  if (!cents) return { status: "error", message: "Enter an amount greater than $0.00." };
  if (input.confirmed !== true) return { status: "error", message: "Tick the confirmation box to continue." };
  const reason = (REASONS as readonly string[]).includes(input.select) ? (input.select as (typeof REASONS)[number]) : null;
  if (!reason) return { status: "error", message: "Choose why this refund is being made." };
  const notes = input.reason?.trim();
  if (!notes || notes.length < 3) return { status: "error", message: "Write a short note saying why." };
  try {
    const result = await issueInvoiceRefund(session.user.id, { invoiceId, amountCents: cents, reason, notes });
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true } });
    revalidatePath("/desk/billing");
    if (invoice) revalidatePath(`/desk/billing/customer/${invoice.customerId}`);
    return { status: "success", message: `Refund recorded. ${await operationState(result.providerOpId)}` };
  } catch (error) {
    return { status: "error", message: plainError(error) };
  }
}

/** Use some of a customer's account credit to pay an open invoice (owner/admin). */
export async function applyCreditAction(
  invoiceId: string,
  input: { amountCents: number; select: string; confirmed: boolean; reason?: string },
): Promise<MoneyActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const cents = whole(input.amountCents);
  if (!cents) return { status: "error", message: "Enter an amount greater than $0.00." };
  if (input.confirmed !== true) return { status: "error", message: "Tick the confirmation box to continue." };
  if (!input.select) return { status: "error", message: "Choose which credit to use." };
  try {
    await applyCreditDecision(session.user.id, { creditId: input.select, invoiceId, amountCents: cents });
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true } });
    revalidatePath("/desk/billing");
    if (invoice) revalidatePath(`/desk/billing/customer/${invoice.customerId}`);
    return { status: "success", message: "Credit applied. The invoice balance went down by that amount." };
  } catch (error) {
    return { status: "error", message: plainError(error) };
  }
}
