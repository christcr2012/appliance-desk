import { prisma } from "@/lib/prisma";

export type StatementLineItem = {
  id: string;
  kind: string;
  description: string;
  amountCents: number;
  quantity: number;
};

export type StatementInvoice = {
  id: string;
  invoiceNumber: number;
  status: string;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  dueDate: Date | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  lateFeeCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  balanceCents: number;
  lineItems: StatementLineItem[];
};

export type StatementProperty = {
  serviceAddressId: string | null;
  addressLabel: string;
  invoices: StatementInvoice[];
  totalDueCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
};

export type StatementReconciliation = {
  openingBalanceCents: number;
  invoiceChargesCents: number;
  receiptAllocationsCents: number;
  creditsAppliedCents: number;
  refundsCents: number;
  closingBalanceCents: number;
};

export type CustomerStatement = {
  customerId: string;
  customerName: string;
  companyName: string | null;
  properties: StatementProperty[];
  totalDueCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
  openInvoiceCount: number;
  reconciliation: StatementReconciliation;
};

function addressLabel(a: {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
} | null): string {
  if (!a) return "No property on file";
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`;
}

function within(date: Date, start?: Date, end?: Date): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function before(date: Date, start?: Date): boolean {
  return Boolean(start && date < start);
}

function invoiceLedgerTotals(invoice: {
  amountDueCents: number;
  payments: Array<{ amountCents: number }>;
  creditApplications: Array<{ amountCents: number }>;
  refunds: Array<{ amountCents: number }>;
}) {
  const receiptAllocationsCents = invoice.payments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  );
  const creditsAppliedCents = invoice.creditApplications.reduce(
    (sum, application) => sum + application.amountCents,
    0,
  );
  const refundsCents = invoice.refunds.reduce(
    (sum, refund) => sum + refund.amountCents,
    0,
  );
  const netAppliedCents =
    receiptAllocationsCents + creditsAppliedCents - refundsCents;
  return {
    receiptAllocationsCents,
    creditsAppliedCents,
    refundsCents,
    netAppliedCents,
    balanceCents: Math.max(0, invoice.amountDueCents - netAppliedCents),
  };
}

/**
 * Customer billing statement with an auditable ledger footer:
 * opening balance + invoice charges - receipt allocations - credits applied
 * + refunds = closing balance.
 *
 * Receipt *allocations* are used here rather than whole Receipt amounts. This
 * keeps an unallocated overpayment from reducing an invoice balance twice when
 * its resulting CustomerCredit is later applied. Whole receipts remain the
 * source of truth for cash reporting/export.
 */
export async function getCustomerStatement(
  customerId: string,
  options?: { periodStart?: Date; periodEnd?: Date },
): Promise<CustomerStatement | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      companyName: true,
      user: { select: { name: true, email: true } },
      invoices: {
        include: {
          lineItems: { orderBy: [{ createdAt: "asc" }] },
          agreement: { select: { serviceAddress: true } },
          payments: {
            where: { status: "succeeded", receiptId: { not: null } },
            select: {
              amountCents: true,
              receipt: { select: { receivedOn: true, amountCents: true } },
            },
          },
          creditApplications: {
            select: { amountCents: true, createdAt: true },
          },
          refunds: {
            select: { amountCents: true, createdAt: true },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  if (!customer) return null;

  const periodStart = options?.periodStart;
  const periodEnd = options?.periodEnd;
  const selectedInvoices = customer.invoices.filter((invoice) => {
    if (!periodStart && !periodEnd) return true;
    const date = invoice.billingPeriodStart ?? invoice.createdAt;
    return within(date, periodStart, periodEnd);
  });

  const groups = new Map<string, StatementProperty>();
  for (const invoice of selectedInvoices) {
    const address = invoice.agreement?.serviceAddress ?? null;
    const groupKey = address?.id ?? "no-property";
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        serviceAddressId: address?.id ?? null,
        addressLabel: addressLabel(address),
        invoices: [],
        totalDueCents: 0,
        totalPaidCents: 0,
        totalBalanceCents: 0,
      };
      groups.set(groupKey, group);
    }

    const ledger = invoiceLedgerTotals(invoice);
    group.invoices.push({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      billingPeriodStart: invoice.billingPeriodStart,
      billingPeriodEnd: invoice.billingPeriodEnd,
      dueDate: invoice.dueDate,
      subtotalCents: invoice.subtotalCents,
      discountCents: invoice.discountCents,
      taxCents: invoice.taxCents,
      lateFeeCents: invoice.lateFeeCents,
      amountDueCents: invoice.amountDueCents,
      amountPaidCents: ledger.netAppliedCents,
      balanceCents: ledger.balanceCents,
      lineItems: invoice.lineItems.map((line) => ({
        id: line.id,
        kind: line.kind,
        description: line.description,
        amountCents: line.amountCents,
        quantity: line.quantity,
      })),
    });
    group.totalDueCents += invoice.amountDueCents;
    group.totalPaidCents += ledger.netAppliedCents;
    group.totalBalanceCents += ledger.balanceCents;
  }

  const properties = Array.from(groups.values()).sort((a, b) =>
    a.addressLabel.localeCompare(b.addressLabel),
  );

  let openingBalanceCents = 0;
  let invoiceChargesCents = 0;
  let receiptAllocationsCents = 0;
  let creditsAppliedCents = 0;
  let refundsCents = 0;

  for (const invoice of customer.invoices) {
    const invoiceDate = invoice.billingPeriodStart ?? invoice.createdAt;
    if (before(invoiceDate, periodStart)) openingBalanceCents += invoice.amountDueCents;
    else if (within(invoiceDate, periodStart, periodEnd)) {
      invoiceChargesCents += invoice.amountDueCents;
    }

    for (const payment of invoice.payments) {
      const receivedOn = payment.receipt?.receivedOn;
      if (!receivedOn) continue;
      if (before(receivedOn, periodStart)) openingBalanceCents -= payment.amountCents;
      else if (within(receivedOn, periodStart, periodEnd)) {
        receiptAllocationsCents += payment.amountCents;
      }
    }
    for (const application of invoice.creditApplications) {
      if (before(application.createdAt, periodStart)) {
        openingBalanceCents -= application.amountCents;
      } else if (within(application.createdAt, periodStart, periodEnd)) {
        creditsAppliedCents += application.amountCents;
      }
    }
    for (const refund of invoice.refunds) {
      if (before(refund.createdAt, periodStart)) openingBalanceCents += refund.amountCents;
      else if (within(refund.createdAt, periodStart, periodEnd)) {
        refundsCents += refund.amountCents;
      }
    }
  }

  const closingBalanceCents =
    openingBalanceCents +
    invoiceChargesCents -
    receiptAllocationsCents -
    creditsAppliedCents +
    refundsCents;

  const openInvoiceCount = selectedInvoices.filter(
    (invoice) => invoiceLedgerTotals(invoice).balanceCents > 0,
  ).length;

  return {
    customerId: customer.id,
    customerName: customer.user.name ?? customer.user.email,
    companyName: customer.companyName,
    properties,
    totalDueCents: properties.reduce((sum, property) => sum + property.totalDueCents, 0),
    totalPaidCents: properties.reduce((sum, property) => sum + property.totalPaidCents, 0),
    totalBalanceCents: properties.reduce(
      (sum, property) => sum + property.totalBalanceCents,
      0,
    ),
    openInvoiceCount,
    reconciliation: {
      openingBalanceCents,
      invoiceChargesCents,
      receiptAllocationsCents,
      creditsAppliedCents,
      refundsCents,
      closingBalanceCents,
    },
  };
}

export async function getCustomersWithOpenBalances() {
  const rows = await prisma.customer.findMany({
    where: {
      invoices: {
        some: { status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] } },
      },
    },
    select: {
      id: true,
      companyName: true,
      isPropertyManager: true,
      user: { select: { name: true, email: true } },
      invoices: {
        where: { status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] } },
        select: {
          amountDueCents: true,
          payments: {
            where: { status: "succeeded", receiptId: { not: null } },
            select: { amountCents: true },
          },
          creditApplications: { select: { amountCents: true } },
          refunds: { select: { amountCents: true } },
        },
      },
      _count: { select: { serviceAddresses: true } },
    },
    orderBy: [{ companyName: "asc" }],
  });

  return rows
    .map((customer) => {
      const balances = customer.invoices.map(
        (invoice) => invoiceLedgerTotals(invoice).balanceCents,
      );
      return {
        id: customer.id,
        customerName: customer.user.name ?? customer.user.email,
        companyName: customer.companyName,
        isPropertyManager: customer.isPropertyManager,
        propertyCount: customer._count.serviceAddresses,
        openInvoiceCount: balances.filter((balance) => balance > 0).length,
        balanceCents: balances.reduce((sum, balance) => sum + balance, 0),
      };
    })
    .filter((customer) => customer.balanceCents > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents);
}
