"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  PaymentLinkError, copyPaymentLink, previewPaymentLink, sendPaymentLink, startPhonePayment,
} from "@/domains/billing/payment-link";
import { PAYMENT_LINK_REASONS, type PaymentLinkReason } from "@/domains/billing/payment-link-message";

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

function fail(error: unknown): { ok: false; message: string } {
  if (error instanceof PaymentLinkError) return { ok: false, message: error.message };
  console.error("payment link action failed", error);
  return { ok: false, message: "Something went wrong. Nothing was sent. Try again, or use Record a payment." };
}
const asReason = (value: string): PaymentLinkReason => {
  if (!(PAYMENT_LINK_REASONS as readonly string[]).includes(value)) throw new PaymentLinkError("Choose a reason.");
  return value as PaymentLinkReason;
};

export async function previewPaymentLinkAction(invoiceId: string, reason: string, note: string): Promise<Result<{ subject: string; text: string; to: string; emailEnabled: boolean }>> {
  try {
    const session = await requireRole("OWNER", "ADMIN");
    const p = await previewPaymentLink(session.user.id, invoiceId, asReason(reason), note);
    return { ok: true, subject: p.subject, text: p.text, to: p.to, emailEnabled: p.emailEnabled };
  } catch (error) { return fail(error); }
}

export async function sendPaymentLinkAction(invoiceId: string, reason: string, note: string, operationKey: string): Promise<Result<{ state: string }>> {
  try {
    const session = await requireRole("OWNER", "ADMIN");
    const r = await sendPaymentLink(session.user.id, invoiceId, asReason(reason), { note, operationKey });
    revalidatePath("/desk/billing");
    return { ok: true, state: r.state };
  } catch (error) { return fail(error); }
}

export async function copyPaymentLinkAction(invoiceId: string): Promise<Result<{ link: string }>> {
  try {
    const session = await requireRole("OWNER", "ADMIN");
    return { ok: true, link: await copyPaymentLink(session.user.id, invoiceId) };
  } catch (error) { return fail(error); }
}

export async function takePaymentByPhoneAction(invoiceId: string, saveCardPermission: boolean): Promise<Result<{ link: string }>> {
  try {
    const session = await requireRole("OWNER", "ADMIN");
    return { ok: true, link: await startPhonePayment(session.user.id, invoiceId, { saveCardPermission }) };
  } catch (error) { return fail(error); }
}
