import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { getStripeClient } from "@/lib/stripe";
import { deliverMessage } from "@/domains/messaging/deliver";
import { isCustomerEmailEnabled } from "@/domains/settings/customer-email-switch";
import {
  PAYMENT_LINK_REASONS, composePaymentLinkMessage, suggestPaymentLinkReason, templateFor, validateTemplate,
  type PaymentLinkReason, type TemplateOverrides,
} from "./payment-link-message";

const PAYABLE = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] as const;
const OPEN_FOR_BALANCE = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] as const;

export class PaymentLinkError extends Error {}

type Loaded = {
  invoice: { id: string; invoiceNumber: number; status: string; stripeInvoiceId: string | null; amountDueCents: number;
    amountPaidCents: number; lateFeeCents: number; dueDate: Date | null; customerId: string;
    lineItems: { description: string }[] };
  customerName: string;
  email: string;
  totalBalanceCents: number;
};

async function load(invoiceId: string): Promise<Loaded> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, status: true, stripeInvoiceId: true, amountDueCents: true, amountPaidCents: true,
      lateFeeCents: true, dueDate: true, customerId: true,
      lineItems: { select: { description: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 3 },
      customer: { select: { user: { select: { name: true, email: true } } } } },
  });
  if (!invoice) throw new PaymentLinkError("Couldn't find that invoice.");
  const open = await prisma.invoice.findMany({
    where: { customerId: invoice.customerId, status: { in: [...OPEN_FOR_BALANCE] } },
    select: { amountDueCents: true, amountPaidCents: true },
  });
  const { customer, ...rest } = invoice;
  return {
    invoice: rest, customerName: customer.user.name ?? customer.user.email, email: customer.user.email,
    totalBalanceCents: open.reduce((sum, i) => sum + Math.max(0, i.amountDueCents - i.amountPaidCents), 0),
  };
}

function assertPayable(inv: Loaded["invoice"]): number {
  const owed = Math.max(0, inv.amountDueCents - inv.amountPaidCents);
  if (!(PAYABLE as readonly string[]).includes(inv.status) || owed <= 0) throw new PaymentLinkError("This bill is already paid or closed, so there is nothing to send.");
  if (!inv.stripeInvoiceId) throw new PaymentLinkError("This bill has no Stripe payment page. Use Record a payment instead.");
  return owed;
}

/** The invoice's own Stripe-hosted payment page. Nothing about the card ever passes through this app. */
export async function getHostedPaymentUrl(stripeInvoiceId: string, owedCents: number): Promise<string> {
  const remote = await getStripeClient().invoices.retrieve(stripeInvoiceId);
  if (remote.status !== "open" || (remote.amount_remaining ?? 0) <= 0) {
    throw new PaymentLinkError("Stripe says this bill isn't open for payment. Reload the page; it may have just been paid.");
  }
  if (remote.amount_remaining !== owedCents) {
    throw new PaymentLinkError("The amount in Stripe differs from the amount here. Ask for a reconciliation before sending a link.");
  }
  const url = remote.hosted_invoice_url;
  if (!url || !url.startsWith("https://")) throw new PaymentLinkError("Stripe has not given a payment page for this bill yet.");
  return url;
}

export async function getTemplateOverrides(): Promise<TemplateOverrides | null> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { paymentLinkTemplates: true } });
  const value = row?.paymentLinkTemplates;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TemplateOverrides) : null;
}

async function compose(actorId: string, invoiceId: string, reason: PaymentLinkReason, note: string | undefined, now: Date) {
  await assertActiveTeamActor(prisma, actorId, ["OWNER", "ADMIN"]);
  if (!(PAYMENT_LINK_REASONS as readonly string[]).includes(reason)) throw new PaymentLinkError("Choose a reason.");
  const loaded = await load(invoiceId);
  const owed = assertPayable(loaded.invoice);
  const link = await getHostedPaymentUrl(loaded.invoice.stripeInvoiceId!, owed);
  const overrides = await getTemplateOverrides();
  const what = loaded.invoice.lineItems.map((l) => l.description).filter(Boolean).join("; ") || "invoice #" + loaded.invoice.invoiceNumber;
  const message = composePaymentLinkMessage({
    reason, template: templateFor(reason, overrides), note,
    facts: { customerName: loaded.customerName, what, owedCents: owed, dueOnKey: loaded.invoice.dueDate ? businessDateKey(loaded.invoice.dueDate) : null,
      todayKey: businessDateKey(now), lateFeeCents: loaded.invoice.lateFeeCents, totalBalanceCents: loaded.totalBalanceCents, link },
  });
  return { loaded, owed, link, message };
}

/** What the owner will see before anything is sent. */
export async function previewPaymentLink(actorId: string, invoiceId: string, reason: PaymentLinkReason, note?: string, now = new Date()) {
  const { loaded, owed, link, message } = await compose(actorId, invoiceId, reason, note, now);
  return { ...message, link, owedCents: owed, to: loaded.email, emailEnabled: await isCustomerEmailEnabled() };
}

/** Sends exactly the previewed text through the durable message boundary (which keeps the text in the customer's history). */
export async function sendPaymentLink(actorId: string, invoiceId: string, reason: PaymentLinkReason, input: { note?: string; operationKey: string }, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.operationKey)) throw new PaymentLinkError("Reload the page and try again.");
  const { loaded, message } = await compose(actorId, invoiceId, reason, input.note, now);
  if (!(await isCustomerEmailEnabled())) {
    throw new PaymentLinkError("Customer email is turned off in Settings, so nothing was sent. Use Copy link to text it yourself.");
  }
  const result = await deliverMessage({
    idempotencyKey: "payment-link:" + invoiceId + ":" + input.operationKey,
    channel: "EMAIL", purpose: "TRANSACTIONAL", templateKey: "payment_link_" + reason.toLowerCase(), customerFacing: true,
    recipient: { type: "Customer", id: loaded.invoice.customerId, address: loaded.email },
    subject: { type: "Invoice", id: invoiceId },
    render: () => ({ subject: message.subject, text: message.text }),
  });
  await prisma.auditLog.create({ data: { userId: actorId, action: "billing.payment_link_sent", entityType: "Invoice", entityId: invoiceId,
    newValue: { reason, state: result.state, textSha256: createHash("sha256").update(message.text).digest("hex") } } });
  return result;
}

/** Copy link: the same page, audited so the history shows who shared it. */
export async function copyPaymentLink(actorId: string, invoiceId: string, now = new Date()) {
  const { link } = await compose(actorId, invoiceId, "REMINDER", undefined, now);
  await prisma.auditLog.create({ data: { userId: actorId, action: "billing.payment_link_copied", entityType: "Invoice", entityId: invoiceId } });
  return link;
}

export async function suggestReasonForInvoice(invoiceId: string): Promise<PaymentLinkReason> {
  const loaded = await load(invoiceId);
  return suggestPaymentLinkReason(loaded.invoice);
}

/** Owner-only, audited, compare-and-set (one wording per reason; null restores the recommended wording). */
export async function saveTemplate(actorId: string, reason: PaymentLinkReason, text: string | null): Promise<void> {
  if (!(PAYMENT_LINK_REASONS as readonly string[]).includes(reason)) throw new PaymentLinkError("Unknown reason.");
  if (text !== null) {
    const problem = validateTemplate(text);
    if (problem) throw new PaymentLinkError(problem);
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const row = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { paymentLinkTemplates: true } });
    const before = (row?.paymentLinkTemplates && typeof row.paymentLinkTemplates === "object" && !Array.isArray(row.paymentLinkTemplates)
      ? row.paymentLinkTemplates : {}) as TemplateOverrides;
    const after: TemplateOverrides = { ...before };
    if (text === null) delete after[reason]; else after[reason] = text.trim();
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { paymentLinkTemplates: Object.keys(after).length ? after : Prisma.DbNull } });
    await tx.auditLog.create({ data: { userId: actorId, action: "billing.payment_link_template." + (text === null ? "restore" : "update"),
      entityType: "BusinessSettings", entityId: "singleton", oldValue: { reason, text: before[reason] ?? null }, newValue: { reason, text: after[reason] ?? null } } });
  });
}

/**
 * "Take payment by phone": the owner opens Stripe's own page for this one bill and types the card the customer reads out.
 * The payment is recorded only by Stripe's confirmation through the normal webhook. Here we only audit who started it and,
 * if ticked, that the customer gave permission to save the card (with the script read).
 */
import { PHONE_CARD_SCRIPT } from "./payment-link-script";

export async function startPhonePayment(actorId: string, invoiceId: string, input: { saveCardPermission: boolean }, now = new Date()): Promise<string> {
  const { loaded, owed, link } = await compose(actorId, invoiceId, "PHONE", undefined, now);
  await prisma.auditLog.create({ data: { userId: actorId, action: "billing.phone_payment_started", entityType: "Invoice", entityId: invoiceId,
    newValue: { customerId: loaded.invoice.customerId, amountCents: owed,
      saveCardPermission: input.saveCardPermission, ...(input.saveCardPermission ? { script: PHONE_CARD_SCRIPT } : {}) } } });
  return link;
}
