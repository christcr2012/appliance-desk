import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { parsePage, paginationMeta } from "@/domains/pagination";

import { revenuePeriod } from "./revenue";
export { revenuePeriod } from "./revenue";

/**
 * Cash received (one row per receipt, however many invoices it paid) or
 * invoice refunds, never inferred rent or profit. "payments" reads Receipt
 * records by the day the money was received, so a combined check appears once
 * and any overpayment is included. Count, sum and the bounded rows share a
 * predicate and database snapshot. Periods are Colorado calendar months.
 */
export async function getRevenueRecords(
  source: "payments" | "refunds",
  monthOnly: boolean,
  rawPage?: string,
  asOf = new Date(),
) {
  await requireRole("OWNER", "ADMIN");
  return prisma.$transaction(
    async (tx) => {
      const period = revenuePeriod(asOf, monthOnly);
      if (source === "payments") {
        const where = { receivedOn: period };
        const total = await tx.receipt.aggregate({
          where,
          _count: { _all: true },
          _sum: { amountCents: true },
        });
        const meta = paginationMeta(total._count._all, parsePage(rawPage), 25);
        const rows = await tx.receipt.findMany({
          where,
          select: {
            id: true,
            amountCents: true,
            method: true,
            source: true,
            receivedOn: true,
            recordedByUserId: true,
            customer: {
              select: { id: true, user: { select: { name: true, email: true } } },
            },
            payments: {
              select: {
                amountCents: true,
                invoice: { select: { id: true, invoiceNumber: true } },
              },
            },
          },
          orderBy: [{ receivedOn: "desc" }, { id: "desc" }],
          skip: meta.skip,
          take: meta.pageSize,
        });
        return {
          meta,
          totalCents: total._sum.amountCents ?? 0,
          toCreditCents: 0,
          rows: rows.map((r) => {
            const allocatedCents = r.payments.reduce((sum, p) => sum + p.amountCents, 0);
            return {
              id: r.id,
              amountCents: r.amountCents,
              createdAt: r.receivedOn,
              customerId: r.customer.id,
              customerName: r.customer.user.name ?? r.customer.user.email,
              method: r.method,
              invoices: r.payments.map((p) => ({
                id: p.invoice.id,
                invoiceNumber: p.invoice.invoiceNumber,
                amountCents: p.amountCents,
              })),
              unallocatedCents: Math.max(0, r.amountCents - allocatedCents),
              basis:
                r.source === "STRIPE"
                  ? "Card or Stripe payment"
                  : r.recordedByUserId
                    ? "Owner-recorded payment"
                    : "Recorded payment",
            };
          }),
        };
      }
      const where = { createdAt: period };
      const total = await tx.refund.aggregate({
        where,
        _count: { _all: true },
        _sum: { amountCents: true },
      });
      const meta = paginationMeta(total._count._all, parsePage(rawPage), 25);
      const rows = await tx.refund.findMany({
        where,
        select: {
          id: true,
          amountCents: true,
          createdAt: true,
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              customerId: true,
              customer: {
                select: { user: { select: { name: true, email: true } } },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: meta.skip,
        take: meta.pageSize,
      });
      // A refund kept as account credit returns no cash; say so row by row and in the total.
      const creditSources = await tx.customerCredit.findMany({
        where: { sourceType: "REFUND_TO_CREDIT", createdAt: period },
        select: { sourceId: true, amountCents: true },
      });
      const creditRefundIds = new Set(creditSources.map((c) => c.sourceId));
      return {
        meta,
        totalCents: total._sum.amountCents ?? 0,
        toCreditCents: creditSources.reduce((sum, c) => sum + c.amountCents, 0),
        rows: rows.map((r) => ({
          id: r.id,
          amountCents: r.amountCents,
          createdAt: r.createdAt,
          customerId: r.invoice.customerId,
          customerName: r.invoice.customer.user.name ?? r.invoice.customer.user.email,
          method: "",
          invoices: [{ id: r.invoice.id, invoiceNumber: r.invoice.invoiceNumber, amountCents: r.amountCents }],
          unallocatedCents: 0,
          basis: creditRefundIds.has(r.id)
            ? "Refund kept as account credit (no cash returned)"
            : "Refund returned to the customer",
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
