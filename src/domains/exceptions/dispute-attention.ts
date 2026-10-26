import { prisma } from "@/lib/prisma";
import { disputeTitle, dueDescription } from "@/domains/disputes/rules";
import type { ExceptionItem } from "./rules";

/**
 * OPS-5 To do items (owner and admins only; the caller gates): a card dispute still waiting for Chris's answer
 * (urgent from 3 days before the deadline), and a bank dispute he has not yet dealt with. Both are "high".
 */
export async function listDisputeAttention(cap: number, now: Date): Promise<{ rows: ExceptionItem[]; total: number }> {
  const where = {
    OR: [
      { isBank: false, state: "NEEDS_RESPONSE" as const, evidenceSubmittedAt: null },
      { isBank: true, handledAt: null },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.paymentDispute.findMany({
      where,
      orderBy: [{ dueBy: { sort: "asc", nulls: "last" } }, { openedAt: "asc" }],
      take: cap,
      select: {
        id: true, amountCents: true, isBank: true, dueBy: true, openedAt: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.paymentDispute.count({ where }),
  ]);
  return {
    total,
    rows: rows.map((row) => {
      const name = row.customer?.user.name ?? row.customer?.user.email ?? null;
      const due = dueDescription(row.dueBy, now);
      return {
        category: "PAYMENT_DISPUTE",
        severity: "high",
        title: disputeTitle({ customerName: name, amountCents: row.amountCents, isBank: row.isBank, dueBy: row.dueBy }, now),
        detail: row.isBank
          ? "A bank payment was disputed. Bank disputes can't be contested, so the bill is owed again. Autopay is off for this customer until you clear it."
          : `${due.overdue ? "The deadline has passed. " : due.urgent ? "Due very soon. " : ""}Review the evidence packet we built from your records, then approve and send it. Stripe accepts only one answer.`,
        href: `/desk/disputes/${row.id}`,
        since: row.openedAt,
        ...(row.dueBy && !row.isBank ? { dueOn: row.dueBy } : {}),
      } satisfies ExceptionItem;
    }),
  };
}
