"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { describeProviderOperation, submitCreditApply, submitDepositDecision, submitInvoiceRefund } from "@/domains/approvals";
import { recalculateLocalInvoiceTax } from "@/domains/tax/local-invoice";

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
    const result = await submitDepositDecision(session.user.id, {
      depositId,
      refundCents: cents,
      deductionReason: input.reason?.trim() || undefined,
    });
    revalidatePath("/desk/billing");
    revalidatePath("/desk/approvals");
    if (result.status !== "DONE") return { status: "success", message: result.message };
    return { status: "success", message: `Deposit decision recorded. ${await describeProviderOperation(result.providerOpId)}` };
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
    const result = await submitInvoiceRefund(session.user.id, { invoiceId, amountCents: cents, reason, notes });
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true } });
    revalidatePath("/desk/billing");
    revalidatePath("/desk/approvals");
    if (invoice) revalidatePath(`/desk/billing/customer/${invoice.customerId}`);
    if (result.status !== "DONE") return { status: "success", message: result.message };
    return { status: "success", message: `Refund recorded. ${await describeProviderOperation(result.providerOpId)}` };
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
    const result = await submitCreditApply(session.user.id, { creditId: input.select, invoiceId, amountCents: cents });
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true } });
    revalidatePath("/desk/billing");
    revalidatePath("/desk/approvals");
    if (invoice) revalidatePath(`/desk/billing/customer/${invoice.customerId}`);
    if (result.status !== "DONE") return { status: "success", message: result.message };
    return { status: "success", message: "Credit applied. The invoice balance went down by that amount." };
  } catch (error) {
    return { status: "error", message: plainError(error) };
  }
}


/** Re-run address-exact tax for a local draft bill after its tax setup is corrected. */
export async function recalculateInvoiceTaxAction(invoiceId: string): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  await recalculateLocalInvoiceTax(session.user.id, invoiceId);
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { customerId: true },
  });
  revalidatePath("/desk/today");
  revalidatePath("/desk/billing");
  if (invoice) {
    revalidatePath(`/desk/billing/customer/${invoice.customerId}`);
    revalidatePath(`/desk/billing/customer/${invoice.customerId}/invoice/${invoiceId}`);
  }
}
