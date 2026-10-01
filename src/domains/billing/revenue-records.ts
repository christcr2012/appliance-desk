import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { parsePage, paginationMeta } from "@/domains/pagination";

import { revenuePeriod } from "./revenue";
export { revenuePeriod } from "./revenue";

/** Recorded gross invoice payments or invoice refunds, never inferred rent/profit.
 * Count, sum and the bounded rows share a predicate and database snapshot. */
export async function getRevenueRecords(
  source: "payments" | "refunds",
  monthOnly: boolean,
  rawPage?: string,
  asOf = new Date(),
) {
  await requireRole("OWNER", "ADMIN");
  return prisma.$transaction(
    async (tx) => {
      const createdAt = revenuePeriod(asOf, monthOnly);
      const select = {
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
      } as const;
      const orderBy = [{ createdAt: "desc" }, { id: "desc" }] as const;
      if (source === "payments") {
        const where = { status: "succeeded", createdAt };
        const total = await tx.payment.aggregate({
          where,
          _count: { _all: true },
          _sum: { amountCents: true },
        });
        const meta = paginationMeta(total._count._all, parsePage(rawPage), 25);
        const rows = await tx.payment.findMany({
          where,
          select: { ...select, recordedByUserId: true },
          orderBy: [...orderBy],
          skip: meta.skip,
          take: meta.pageSize,
        });
        return {
          meta,
          totalCents: total._sum.amountCents ?? 0,
          rows: rows.map((r) => ({
            id: r.id,
            amountCents: r.amountCents,
            createdAt: r.createdAt,
            invoice: r.invoice,
            basis: r.recordedByUserId
              ? "Owner-recorded payment"
              : "Provider-reported payment",
          })),
        };
      }
      const where = { createdAt };
      const total = await tx.refund.aggregate({
        where,
        _count: { _all: true },
        _sum: { amountCents: true },
      });
      const meta = paginationMeta(total._count._all, parsePage(rawPage), 25);
      const rows = await tx.refund.findMany({
        where,
        select,
        orderBy: [...orderBy],
        skip: meta.skip,
        take: meta.pageSize,
      });
      return {
        meta,
        totalCents: total._sum.amountCents ?? 0,
        rows: rows.map((r) => ({ ...r, basis: "Recorded invoice refund" })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
