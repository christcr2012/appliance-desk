// Generic accounting export: one row per real money movement. Successful
// incoming cash comes from Receipt, never from its per-invoice Payment
// allocations; that prevents one combined check from appearing as several
// independent cash receipts. Refunds remain independent outflows.
import { prisma } from "@/lib/prisma";

export type AccountingTransactionType =
  | "Payment"
  | "Refund"
  | "Refund to account credit"
  | "Deposit refunded";

export type AccountingTransactionRow = {
  /** Receipt id for payments, refund id for refunds, so every row can be traced to the ledger. */
  recordId: string;
  /** Where a payment came from (STRIPE or MANUAL); blank for refunds and deposits. */
  source: string;
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
  const [receipts, refunds, deposits, creditRefunds] = await prisma.$transaction(
    async (tx) =>
      Promise.all([
        tx.receipt.findMany({
          select: {
            id: true,
            source: true,
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
            id: true,
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
        tx.customerCredit.findMany({
          where: { sourceType: "REFUND_TO_CREDIT" },
          select: { sourceId: true },
        }),
      ]),
    { isolationLevel: "RepeatableRead" },
  );
  // A refund kept as account credit moves no cash; label it so the export's
  // cash total is not understated.
  const creditRefundIds = new Set(creditRefunds.map((c) => c.sourceId));

  const rows: AccountingTransactionRow[] = [];

  for (const receipt of receipts) {
    const invoiceNumbers = [
      ...new Set(receipt.payments.map((payment) => payment.invoice.invoiceNumber)),
    ];
    rows.push({
      recordId: receipt.id,
      source: receipt.source,
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
      recordId: refund.id,
      source: "",
      date: refund.createdAt,
      type: creditRefundIds.has(refund.id) ? "Refund to account credit" : "Refund",
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
      recordId: "",
      source: "",
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
