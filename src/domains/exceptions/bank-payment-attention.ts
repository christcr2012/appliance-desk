// BILL-1: To do items for bank payments that are taking too long, or that Stripe says cleared but are not recorded.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { bankingDaysBetween } from "@/lib/business-date";
import { getBusinessSettings } from "@/domains/settings";
import { BANK_PAYMENT_SLOW_DAYS_DEFAULT } from "@/domains/billing/in-flight";
import { bankPaymentSlowException, type ExceptionItem } from "./rules";

/** Open flags older than the owner's number of banking days, plus every flag Stripe already says cleared. */
export async function listBankPaymentSlow(
  limit: number,
  now: Date,
  scope?: { customerId?: string },
): Promise<{ rows: ExceptionItem[]; total: number }> {
  await requireRole("OWNER", "ADMIN");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded bank payment limit is required.");
  const settings = await getBusinessSettings();
  const slowDays = settings.bankPaymentSlowBusinessDays ?? BANK_PAYMENT_SLOW_DAYS_DEFAULT;
  // N banking days are never fewer than N calendar days, so anything newer than that cannot be slow yet.
  const oldestStillFresh = new Date(now.getTime() - slowDays * 24 * 60 * 60 * 1000);
  const open = await prisma.bankPaymentInFlight.findMany({
    where: {
      clearedAt: null,
      ...(scope?.customerId
        ? { OR: [{ invoice: { customerId: scope.customerId } }, { agreement: { customerId: scope.customerId } }] }
        : {}),
      AND: [{ OR: [{ settledInStripeAt: { not: null } }, { startedAt: { lte: oldestStillFresh } }] }],
    },
    select: {
      id: true,
      amountCents: true,
      startedAt: true,
      settledInStripeAt: true,
      invoiceId: true,
      invoice: { select: { customerId: true, customer: { select: { user: { select: { name: true, email: true } } } } } },
      agreement: { select: { customerId: true, customer: { select: { user: { select: { name: true, email: true } } } } } },
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  const due = open
    .map((row) => ({ row, days: bankingDaysBetween(row.startedAt, now) }))
    .filter(({ row, days }) => row.settledInStripeAt !== null || days >= slowDays);
  const rows = due.slice(0, limit).map(({ row, days }) => {
    const customer = row.invoice?.customer ?? row.agreement?.customer ?? null;
    return bankPaymentSlowException({
      id: row.id,
      customerId: row.invoice?.customerId ?? row.agreement?.customerId ?? null,
      invoiceId: row.invoiceId,
      customerName: customer ? (customer.user.name ?? customer.user.email) : "A customer",
      amountCents: row.amountCents,
      startedAt: row.startedAt,
      bankingDaysOld: days,
      settledInStripeAt: row.settledInStripeAt,
    });
  });
  return { rows, total: due.length };
}
