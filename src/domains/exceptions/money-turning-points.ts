import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { HELD_PAYMENT_STATUS } from "@/domains/billing/payment-status";
import { getDepositLiability } from "@/domains/billing/deposit-liability";
import { customerContact, type ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };
const name = (c: { user: { name: string | null; email: string } }) => c.user.name ?? c.user.email;
const dollars = (cents: number) => "$" + (cents / 100).toFixed(2);

function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
}

/** One To do per held payment: the money arrived after the bill was written off or cancelled and waits for the owner. */
export async function listHeldPaymentAttention(limit: number): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const where = { status: HELD_PAYMENT_STATUS };
  const payments = await prisma.payment.findMany({
    where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
    select: { id: true, amountCents: true, createdAt: true,
      invoice: { select: { invoiceNumber: true, customer: { select: { user: { select: { name: true, email: true } } } } } } },
  });
  return {
    rows: payments.map((p): ExceptionItem => ({
      category: "HELD_PAYMENT_DECISION", severity: "high",
      title: name(p.invoice.customer) + "'s " + dollars(p.amountCents) + " payment is on hold",
      detail: "Money arrived for invoice #" + p.invoice.invoiceNumber + " after it was written off or cancelled. Decide: mark it paid, keep it as credit, or refund it.",
      href: "/desk/billing/held-payments", amountCents: p.amountCents, since: p.createdAt,
      primaryAction: { href: "/desk/billing/held-payments", label: "Decide" },
    })),
    total: payments.length < limit ? payments.length : await prisma.payment.count({ where }),
  };
}

/** One To do per deposit on an ended or cancelled rental that has no refund decision yet. Deposits on rentals still in progress are not listed. */
export async function listDepositDecisionAttention(limit: number, now: Date, scope?: { customerId?: string }): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const liability = await getDepositLiability(now);
  const ended = liability.rows.filter(
    (r) => r.bucket !== "STILL_RENTING" && (!scope?.customerId || r.customerId === scope.customerId),
  );
  return {
    rows: ended.slice(0, limit).map((r): ExceptionItem => ({
      category: "DEPOSIT_DECISION", severity: r.overdue ? "high" : "medium",
      title: r.customerName + "'s " + dollars(r.amountCents) + " deposit needs a decision",
      detail: "The rental ended " + (r.daysSinceEnd ?? 0) + (r.daysSinceEnd === 1 ? " day" : " days") + " ago and the deposit has not been refunded or kept.",
      href: "/desk/billing/deposits/" + encodeURIComponent(r.depositId), amountCents: r.amountCents,
      since: new Date(now.getTime() - (r.daysSinceEnd ?? 0) * 86_400_000),
      primaryAction: { href: "/desk/billing/deposits/" + encodeURIComponent(r.depositId), label: "Decide" },
      contact: customerContact({ phone: r.customerPhone, user: { email: r.customerEmail ?? "" } }),
    })),
    total: ended.length,
  };
}
