// Generic accounting export: one row per real money movement. Successful
// incoming cash comes from Receipt, never from its per-invoice Payment
// allocations; that prevents one combined check from appearing as several
// independent cash receipts. Refunds remain independent outflows.
import { prisma } from "@/lib/prisma";

export type AccountingTransactionType =
  | "Payment"
  | "Refund"
  | "Deposit refunded";

export type AccountingTransactionRow = {
  date: Date;
  type: AccountingTransactionType;
  customerName: string;
  companyName: string;
  invoiceNumber: number | null;
  amountCents: number;
  methodOrReason: string;
  notes: string;
};

function customerDisplayName(customer: {
  user: { name: string | null; email: string };
  companyName: string | null;
}) {
  return customer.user.name ?? customer.user.email;
}

export async function getAccountingTransactions(): Promise<
  AccountingTransactionRow[]
> {
  const [receipts, refunds, deposits] = await prisma.$transaction(
    async (tx) =>
      Promise.all([
        tx.receipt.findMany({
          select: {
            amountCents: true,
            method: true,
            notes: true,
            receivedOn: true,
            customer: {
              select: {
                companyName: true,
                user: { select: { name: true, email: true } },
              },
            },
            payments: {
              select: { invoice: { select: { invoiceNumber: true } } },
            },
          },
        }),
        tx.refund.findMany({
          select: {
            amountCents: true,
            reason: true,
            notes: true,
            createdAt: true,
            invoice: {
              select: {
                invoiceNumber: true,
                customer: {
                  select: {
                    companyName: true,
                    user: { select: { name: true, email: true } },
                  },
                },
              },
            },
          },
        }),
        tx.deposit.findMany({
          where: { refundedAt: { not: null } },
          select: {
            refundedAt: true,
            refundedAmountCents: true,
            deductionReason: true,
            agreement: {
              select: {
                customer: {
                  select: {
                    companyName: true,
                    user: { select: { name: true, email: true } },
                  },
                },
              },
            },
          },
        }),
      ]),
    { isolationLevel: "RepeatableRead" },
  );

  const rows: AccountingTransactionRow[] = [];

  for (const receipt of receipts) {
    const invoiceNumbers = [
      ...new Set(receipt.payments.map((payment) => payment.invoice.invoiceNumber)),
    ];
    rows.push({
      date: receipt.receivedOn,
      type: "Payment",
      customerName: customerDisplayName(receipt.customer),
      companyName: receipt.customer.companyName ?? "",
      // One receipt can span several invoices. Leave the single-invoice
      // reference blank rather than falsely assigning the whole cash event to
      // one allocation; detailed allocation remains in Payment rows.
      invoiceNumber: invoiceNumbers.length === 1 ? invoiceNumbers[0]! : null,
      amountCents: receipt.amountCents,
      methodOrReason: receipt.method,
      notes: receipt.notes ?? "",
    });
  }

  for (const refund of refunds) {
    rows.push({
      date: refund.createdAt,
      type: "Refund",
      customerName: customerDisplayName(refund.invoice.customer),
      companyName: refund.invoice.customer.companyName ?? "",
      invoiceNumber: refund.invoice.invoiceNumber,
      amountCents: -refund.amountCents,
      methodOrReason: refund.reason,
      notes: refund.notes ?? "",
    });
  }

  for (const deposit of deposits) {
    if (!deposit.refundedAt) continue;
    rows.push({
      date: deposit.refundedAt,
      type: "Deposit refunded",
      customerName: customerDisplayName(deposit.agreement.customer),
      companyName: deposit.agreement.customer.companyName ?? "",
      invoiceNumber: null,
      amountCents: -(deposit.refundedAmountCents ?? 0),
      methodOrReason: "",
      notes: deposit.deductionReason ?? "",
    });
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
}
