// Generic accounting export (2026-09-28, Task #73) — a plain CSV of
// every real money movement this app knows about, for Chris to hand to
// a bookkeeper or import into whatever accounting software he ends up
// using (he doesn't have one yet — see docs/BUSINESS-RULES.md's growth-
// ideas list, idea #14). Deliberately not QuickBooks-specific: a flat,
// generic "date / type / who / reference / amount" shape any tool can
// import, rather than betting on one product's own format.
//
// Covers every place real money actually moves in this app: a
// succeeded card/ACH payment, a refund on an invoice, a security
// deposit collected at signing, and a security deposit refunded at
// move-out. Amounts follow the standard accounting-ledger convention —
// positive for money coming in, negative for money going back out — so
// a plain SUM() of the amount column in a spreadsheet is the real net
// cash movement, not something the bookkeeper has to sign-flip by hand.
import { prisma } from "@/lib/prisma";

export type AccountingTransactionType = "Payment" | "Refund" | "Deposit collected" | "Deposit refunded";

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

function customerDisplayName(customer: { user: { name: string | null; email: string }; companyName: string | null }) {
  return customer.user.name ?? customer.user.email;
}

/**
 * Every real money movement, oldest first — the natural order for a
 * bookkeeper reading it top to bottom, and for a running-balance check
 * in a spreadsheet. Pulls straight from Payment/Refund/Deposit, never
 * re-derives an amount — these tables are already the source of truth
 * for what actually happened (docs/DATABASE.md).
 */
export async function getAccountingTransactions(): Promise<AccountingTransactionRow[]> {
  const [payments, refunds, deposits] = await Promise.all([
    prisma.payment.findMany({
      where: { status: "succeeded" },
      select: {
        amountCents: true,
        method: true,
        createdAt: true,
        invoice: {
          select: {
            invoiceNumber: true,
            customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
          },
        },
      },
    }),
    prisma.refund.findMany({
      select: {
        amountCents: true,
        reason: true,
        notes: true,
        createdAt: true,
        invoice: {
          select: {
            invoiceNumber: true,
            customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
          },
        },
      },
    }),
    prisma.deposit.findMany({
      select: {
        amountCents: true,
        createdAt: true,
        refundedAt: true,
        refundedAmountCents: true,
        deductionReason: true,
        agreement: {
          select: {
            customer: { select: { companyName: true, user: { select: { name: true, email: true } } } },
          },
        },
      },
    }),
  ]);

  const rows: AccountingTransactionRow[] = [];

  for (const p of payments) {
    rows.push({
      date: p.createdAt,
      type: "Payment",
      customerName: customerDisplayName(p.invoice.customer),
      companyName: p.invoice.customer.companyName ?? "",
      invoiceNumber: p.invoice.invoiceNumber,
      amountCents: p.amountCents,
      methodOrReason: p.method ?? "",
      notes: "",
    });
  }

  for (const r of refunds) {
    rows.push({
      date: r.createdAt,
      type: "Refund",
      customerName: customerDisplayName(r.invoice.customer),
      companyName: r.invoice.customer.companyName ?? "",
      invoiceNumber: r.invoice.invoiceNumber,
      amountCents: -r.amountCents,
      methodOrReason: r.reason,
      notes: r.notes ?? "",
    });
  }

  for (const d of deposits) {
    rows.push({
      date: d.createdAt,
      type: "Deposit collected",
      customerName: customerDisplayName(d.agreement.customer),
      companyName: d.agreement.customer.companyName ?? "",
      invoiceNumber: null,
      amountCents: d.amountCents,
      methodOrReason: "",
      notes: "",
    });
    if (d.refundedAt) {
      rows.push({
        date: d.refundedAt,
        type: "Deposit refunded",
        customerName: customerDisplayName(d.agreement.customer),
        companyName: d.agreement.customer.companyName ?? "",
        invoiceNumber: null,
        amountCents: -(d.refundedAmountCents ?? 0),
        methodOrReason: "",
        notes: d.deductionReason ?? "",
      });
    }
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
}
