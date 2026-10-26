import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { detectDrift } from "@/domains/billing/reconciliation";

export async function loadBillingReconciliationPageData() {
  await requireRole("OWNER", "ADMIN");
  const checkedAt = new Date();
  const rows = await detectDrift();
  // BILL-1: bank payments Stripe says cleared that are not recorded yet (the nightly check could not record them).
  const bankPayments = await prisma.bankPaymentInFlight.findMany({
    where: { clearedAt: null, settledInStripeAt: { not: null } },
    select: {
      id: true,
      amountCents: true,
      settledInStripeAt: true,
      invoice: { select: { invoiceNumber: true, customer: { select: { user: { select: { name: true, email: true } } } } } },
      agreement: { select: { customer: { select: { user: { select: { name: true, email: true } } } } } },
    },
    orderBy: [{ settledInStripeAt: "asc" }, { id: "asc" }],
    take: 50,
  });
  return {
    checkedAt,
    rows,
    bankPayments: bankPayments.map((row) => {
      const customer = row.invoice?.customer ?? row.agreement?.customer ?? null;
      return {
        id: row.id,
        amountCents: row.amountCents,
        since: row.settledInStripeAt as Date,
        customerName: customer ? (customer.user.name ?? customer.user.email) : "A customer",
        invoiceNumber: row.invoice?.invoiceNumber ?? null,
      };
    }),
  };
}
