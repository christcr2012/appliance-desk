// AR-3 (MONEY-AREA 3): the bill record's Activity timeline — read-only. Payments of every status (including
// decided held payments, which no Payments tab lists), refunds, credit applications and the phone payment
// page openings recorded in the audit log, newest first, as kit Timeline items.
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money-ui";
import type { TimelineItem } from "@/components/kit/timeline";
import {
  FAILED_PAYMENT_STATUSES,
  HELD_CONFLICT_STATUS,
  HELD_PAYMENT_STATUS,
  HELD_REFUNDED_STATUS,
  HELD_TO_CREDIT_STATUS,
  isSuccessfulPaymentStatus,
} from "./payment-status";

function paymentItem(payment: {
  id: string;
  status: string;
  amountCents: number;
  createdAt: Date;
  recordedByUserId: string | null;
}, actor: string): TimelineItem {
  const amount = formatMoney(payment.amountCents);
  if (isSuccessfulPaymentStatus(payment.status))
    return { id: `payment-${payment.id}`, at: payment.createdAt, title: `Payment received · ${amount}`, tone: "good", actor };
  if ((FAILED_PAYMENT_STATUSES as readonly string[]).includes(payment.status))
    return { id: `payment-${payment.id}`, at: payment.createdAt, title: `Payment failed · ${amount}`, tone: "attention", actor };
  if (payment.status === HELD_PAYMENT_STATUS)
    return { id: `payment-${payment.id}`, at: payment.createdAt, title: "Payment held for your decision", tone: "attention", actor };
  if (payment.status === HELD_CONFLICT_STATUS)
    return {
      id: `payment-${payment.id}`,
      at: payment.createdAt,
      title: `Payment held · ${amount}`,
      detail: "Refunded in Stripe after it was used as credit",
      tone: "danger",
      actor,
    };
  if (payment.status === HELD_TO_CREDIT_STATUS)
    return { id: `payment-${payment.id}`, at: payment.createdAt, title: `Payment kept as credit · ${amount}`, tone: "neutral", actor };
  if (payment.status === HELD_REFUNDED_STATUS)
    return { id: `payment-${payment.id}`, at: payment.createdAt, title: `Payment sent back · ${amount}`, tone: "neutral", actor };
  return { id: `payment-${payment.id}`, at: payment.createdAt, title: `Payment recorded · ${amount}`, tone: "neutral", actor };
}

export async function getBillTimeline(invoiceId: string): Promise<TimelineItem[]> {
  const [invoice, payments, refunds, applications, phoneStarts] = await Promise.all([
    prisma.invoice.findUnique({ where: { id: invoiceId }, select: { createdAt: true } }),
    prisma.payment.findMany({
      where: { invoiceId },
      select: { id: true, status: true, amountCents: true, createdAt: true, recordedByUserId: true },
    }),
    prisma.refund.findMany({
      where: { invoiceId },
      select: { id: true, amountCents: true, createdAt: true, authorizedByUserId: true },
    }),
    prisma.creditApplication.findMany({
      where: { invoiceId },
      select: { id: true, amountCents: true, createdAt: true, appliedByUserId: true },
    }),
    prisma.auditLog.findMany({
      where: { action: "billing.phone_payment_started", entityType: "Invoice", entityId: invoiceId },
      select: { id: true, createdAt: true, userId: true },
    }),
  ]);
  if (!invoice) return [];

  const userIds = [
    ...payments.map((p) => p.recordedByUserId),
    ...refunds.map((r) => r.authorizedByUserId),
    ...applications.map((a) => a.appliedByUserId),
    ...phoneStarts.map((a) => a.userId),
  ].filter((id): id is string => Boolean(id));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true, email: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const actorOf = (userId: string | null) => (userId ? (names.get(userId) ?? "automatic") : "automatic");

  const items: TimelineItem[] = [
    { id: `invoice-${invoiceId}`, at: invoice.createdAt, title: "Bill created", tone: "neutral", actor: "automatic" },
    ...payments.map((p) => paymentItem(p, actorOf(p.recordedByUserId))),
    ...refunds.map((r) => ({
      id: `refund-${r.id}`,
      at: r.createdAt,
      title: `Refunded · ${formatMoney(r.amountCents)}`,
      tone: "neutral" as const,
      actor: actorOf(r.authorizedByUserId),
    })),
    ...applications.map((a) => ({
      id: `credit-${a.id}`,
      at: a.createdAt,
      title: `Paid with credit · ${formatMoney(a.amountCents)}`,
      tone: "good" as const,
      actor: actorOf(a.appliedByUserId),
    })),
    ...phoneStarts.map((a) => ({
      id: `phone-${a.id}`,
      at: a.createdAt,
      title: "Phone payment page opened",
      tone: "neutral" as const,
      actor: actorOf(a.userId),
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
