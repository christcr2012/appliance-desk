import { prisma } from "@/lib/prisma";
import { SUCCESSFUL_PAYMENT_STATUSES } from "./payment-status";

// ---------------------------------------------------------------------------
// Consolidated statements (Task #72, docs/DECISIONS.md 2026-09-28
// "Consolidated statements + manual payments + automated late fees") —
// the piece of "formal B2B invoicing for property managers" that's safe
// to build without touching how Stripe actually charges anyone.
//
// Every RentalAgreement still bills independently through its own Stripe
// Subscription (see docs/ARCHITECTURE.md's "Payments (Stripe)" section) —
// that machinery is untouched. What's new here is a READ-ONLY rollup: one
// customer's invoices across every property they have, grouped by
// ServiceAddress, with running totals — the "one statement" a property
// manager with several buildings actually wants to look at, even though
// each property is still charged separately underneath. Combining the
// actual Stripe charges into one transaction is a much bigger, riskier
// change (see that DECISIONS.md entry for why it was deliberately not
// attempted) and isn't needed to solve the real problem: seeing
// everything in one place, and being able to record one combined payment
// against it (src/domains/billing/manual-payments.ts).
// ---------------------------------------------------------------------------

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

/**
 * How the statement's closing balance is built from the ledger, so a reader
 * can check it adds up:
 *   carried forward + invoiced - payments applied - credits applied
 *   - written off = balance owed.
 * `balanced` is false when the stored invoice totals do not match the payment
 * and credit records (for example an old payment with no allocation record);
 * the screen then says the statement needs review instead of hiding it.
 * Refunds never reopen an invoice, so they are shown beside the balance.
 */
export type StatementReconciliation = {
  /** Still owed on invoices from before the chosen period (0 when no period is chosen). */
  carriedForwardCents: number;
  /** Total billed on non-draft, non-voided invoices in the statement. */
  invoicedCents: number;
  paymentsAppliedCents: number;
  creditsAppliedCents: number;
  /** Unpaid remainder forgiven on written-off invoices. */
  writtenOffCents: number;
  /** What the customer owes now (carried forward plus unpaid open invoices). */
  closingBalanceCents: number;
  balanced: boolean;
  /** Refunds recorded against these invoices: shown for information, not part of the balance. */
  refundedCents: number;
  /** Unspent account credit the customer holds. */
  creditAvailableCents: number;
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

/** Invoices whose unpaid remainder is money the customer still owes. */
const OWED_STATUSES = new Set(["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"]);
/** Invoices that count as billed: drafts and voided invoices never reached the customer. */
const NOT_BILLED_STATUSES = new Set(["DRAFT", "VOID"]);

export type ReconciliationInvoice = {
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  succeededPaymentCents: number;
  creditAppliedCents: number;
  refundedCents: number;
};

/** Pure: builds the reconciliation from invoice records. */
export function reconcileStatement(
  invoices: ReconciliationInvoice[],
  carriedForwardCents: number,
  creditAvailableCents: number,
): StatementReconciliation {
  let invoicedCents = 0;
  let paymentsAppliedCents = 0;
  let creditsAppliedCents = 0;
  let writtenOffCents = 0;
  let owedCents = 0;
  let refundedCents = 0;
  for (const invoice of invoices) {
    refundedCents += invoice.refundedCents;
    if (NOT_BILLED_STATUSES.has(invoice.status)) continue;
    const unpaid = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
    invoicedCents += invoice.amountDueCents;
    paymentsAppliedCents += invoice.succeededPaymentCents;
    creditsAppliedCents += invoice.creditAppliedCents;
    if (invoice.status === "WRITTEN_OFF") writtenOffCents += unpaid;
    if (OWED_STATUSES.has(invoice.status)) owedCents += unpaid;
  }
  const closingBalanceCents = carriedForwardCents + owedCents;
  const balanced =
    carriedForwardCents + invoicedCents - paymentsAppliedCents - creditsAppliedCents - writtenOffCents ===
    closingBalanceCents;
  return {
    carriedForwardCents,
    invoicedCents,
    paymentsAppliedCents,
    creditsAppliedCents,
    writtenOffCents,
    closingBalanceCents,
    balanced,
    refundedCents,
    creditAvailableCents,
  };
}

function addressLabel(a: { line1: string; line2: string | null; city: string; state: string; zip: string } | null): string {
  if (!a) return "No property on file";
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`;
}

/**
 * One customer's whole billing picture, grouped by property instead of
 * one flat list — the desk-side "combined statement"
 * (/desk/billing/customer/[id]) and, for a customer with more than one
 * property, the same grouping the customer portal's own /account/billing
 * uses (docs/BUSINESS-RULES.md's "customer portal's own 'All properties'
 * selector" gap — grouping the existing per-property invoices in place
 * turned out to answer that better than a separate address-switcher
 * would, since a property manager wants to see every property's balance
 * at once, not pick one to hide the rest).
 *
 * Optionally scoped to a billing period (periodStart/periodEnd, matched
 * against Invoice.billingPeriodStart) — omitted, every invoice on file is
 * included, which is what both UIs use by default (a property manager
 * wants to see everything currently owed, not just one month).
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
        where:
          options?.periodStart || options?.periodEnd
            ? {
                billingPeriodStart: {
                  gte: options.periodStart,
                  lte: options.periodEnd,
                },
              }
            : undefined,
        include: {
          lineItems: { orderBy: [{ createdAt: "asc" }] },
          agreement: { select: { serviceAddress: true } },
          payments: { where: { status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] } }, select: { amountCents: true } },
          creditApplications: { select: { amountCents: true } },
          refunds: { select: { amountCents: true } },
        },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  if (!customer) return null;

  // Money still owed on invoices from before a chosen period, plus the
  // customer's unspent credit, so the closing balance is the full picture.
  const [earlier, credits] = await Promise.all([
    options?.periodStart
      ? prisma.invoice.findMany({
          where: {
            customerId,
            status: { in: [...OWED_STATUSES] as never[] },
            billingPeriodStart: { lt: options.periodStart },
          },
          select: { amountDueCents: true, amountPaidCents: true },
        })
      : Promise.resolve([]),
    prisma.customerCredit.aggregate({
      where: { customerId },
      _sum: { remainingCents: true },
    }),
  ]);
  const carriedForwardCents = earlier.reduce(
    (sum, inv) => sum + Math.max(0, inv.amountDueCents - inv.amountPaidCents),
    0,
  );

  const groups = new Map<string, StatementProperty>();

  for (const invoice of customer.invoices) {
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

    // Only invoices the customer still owes count toward a balance; a voided
    // draft or a written-off invoice owes nothing.
    const balanceCents = OWED_STATUSES.has(invoice.status)
      ? Math.max(0, invoice.amountDueCents - invoice.amountPaidCents)
      : 0;
    const billed = !NOT_BILLED_STATUSES.has(invoice.status);
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
      amountPaidCents: invoice.amountPaidCents,
      balanceCents,
      lineItems: invoice.lineItems.map((li) => ({
        id: li.id,
        kind: li.kind,
        description: li.description,
        amountCents: li.amountCents,
        quantity: li.quantity,
      })),
    });
    if (billed) {
      group.totalDueCents += invoice.amountDueCents;
      group.totalPaidCents += invoice.amountPaidCents;
    }
    group.totalBalanceCents += balanceCents;
  }

  const properties = Array.from(groups.values()).sort((a, b) =>
    a.addressLabel.localeCompare(b.addressLabel),
  );

  const openInvoiceCount = customer.invoices.filter((inv) =>
    ["OPEN", "PARTIALLY_PAID", "DELINQUENT"].includes(inv.status),
  ).length;

  const reconciliation = reconcileStatement(
    customer.invoices.map((inv) => ({
      status: inv.status,
      amountDueCents: inv.amountDueCents,
      amountPaidCents: inv.amountPaidCents,
      succeededPaymentCents: inv.payments.reduce((sum, p) => sum + p.amountCents, 0),
      creditAppliedCents: inv.creditApplications.reduce((sum, c) => sum + c.amountCents, 0),
      refundedCents: inv.refunds.reduce((sum, r) => sum + r.amountCents, 0),
    })),
    carriedForwardCents,
    credits._sum.remainingCents ?? 0,
  );

  return {
    customerId: customer.id,
    customerName: customer.user.name ?? customer.user.email,
    companyName: customer.companyName,
    properties,
    totalDueCents: properties.reduce((s, p) => s + p.totalDueCents, 0),
    totalPaidCents: properties.reduce((s, p) => s + p.totalPaidCents, 0),
    totalBalanceCents: properties.reduce((s, p) => s + p.totalBalanceCents, 0),
    openInvoiceCount,
    reconciliation,
  };
}

/** Every customer with more than one open/unpaid invoice right now —
 * feeds /desk/billing's "Statements" view, which lists customers (not
 * individual invoices) so Chris can jump straight to whoever has a
 * balance, instead of scanning a flat invoice table for repeated names. */
export async function getCustomersWithOpenBalances() {
  const rows = await prisma.customer.findMany({
    where: {
      invoices: { some: { status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] } } },
    },
    select: {
      id: true,
      companyName: true,
      isPropertyManager: true,
      user: { select: { name: true, email: true } },
      invoices: {
        where: { status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] } },
        select: { amountDueCents: true, amountPaidCents: true },
      },
      _count: { select: { serviceAddresses: true } },
    },
    orderBy: [{ companyName: "asc" }],
  });

  return rows
    .map((c) => ({
      id: c.id,
      customerName: c.user.name ?? c.user.email,
      companyName: c.companyName,
      isPropertyManager: c.isPropertyManager,
      propertyCount: c._count.serviceAddresses,
      openInvoiceCount: c.invoices.length,
      balanceCents: c.invoices.reduce(
        (sum, inv) => sum + Math.max(0, inv.amountDueCents - inv.amountPaidCents),
        0,
      ),
    }))
    .sort((a, b) => b.balanceCents - a.balanceCents);
}
