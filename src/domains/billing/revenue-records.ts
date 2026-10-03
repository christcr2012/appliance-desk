import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { parsePage, paginationMeta } from "@/domains/pagination";

import { cashRevenuePeriod } from "./revenue";
export { cashRevenuePeriod, revenuePeriod } from "./revenue";

/**
 * Bounded cash-ledger records. The historical `payments` query-string value is
 * retained for URL compatibility, but its rows are now Receipt cash events,
 * not per-invoice Payment allocations. Refunds remain separate outflows.
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
      if (source === "payments") {
        const receivedOn = cashRevenuePeriod(asOf, monthOnly);
        const where = { receivedOn };
        const total = await tx.receipt.aggregate({
          where,
          _count: { _all: true },
          _sum: { amountCents: true },
        });
        const meta = paginationMeta(total._count._all, parsePage(rawPage), 25);
        const receipts = await tx.receipt.findMany({
          where,
          select: {
            id: true,
            source: true,
            amountCents: true,
            method: true,
            receivedOn: true,
            customer: {
              select: {
                id: true,
                user: { select: { name: true, email: true } },
              },
            },
            payments: {
              select: {
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
            },
          },
          orderBy: [{ receivedOn: "desc" }, { id: "desc" }],
          skip: meta.skip,
          take: meta.pageSize,
        });

        return {
          meta,
          totalCents: total._sum.amountCents ?? 0,
          rows: receipts.map((receipt) => {
            const invoices = [
              ...new Map(
                receipt.payments.map((payment) => [
                  payment.invoice.id,
                  payment.invoice,
                ]),
              ).values(),
            ];
            return {
              id: receipt.id,
              amountCents: receipt.amountCents,
              createdAt: receipt.receivedOn,
              receivedOn: receipt.receivedOn,
              receiptId: receipt.id,
              source: receipt.source,
              method: receipt.method,
              customer: receipt.customer,
              invoice: invoices.length === 1 ? invoices[0]! : null,
              allocationCount: invoices.length,
              basis: `${receipt.source === "MANUAL" ? "Owner-recorded" : "Provider-reported"} cash receipt`,
            };
          }),
        };
      }

      const createdAt = cashRevenuePeriod(asOf, monthOnly);
      const where = { createdAt };
      const total = await tx.refund.aggregate({
        where,
        _count: { _all: true },
        _sum: { amountCents: true },
      });
      const meta = paginationMeta(total._count._all, parsePage(rawPage), 25);
      const refunds = await tx.refund.findMany({
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
                select: {
                  id: true,
                  user: { select: { name: true, email: true } },
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: meta.skip,
        take: meta.pageSize,
      });
      return {
        meta,
        totalCents: total._sum.amountCents ?? 0,
        rows: refunds.map((refund) => ({
          id: refund.id,
          amountCents: refund.amountCents,
          createdAt: refund.createdAt,
          receivedOn: refund.createdAt,
          receiptId: null,
          source: "REFUND" as const,
          method: null,
          customer: {
            id: refund.invoice.customer.id,
            user: refund.invoice.customer.user,
          },
          invoice: refund.invoice,
          allocationCount: 1,
          basis: "Recorded invoice refund",
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
