import { prisma } from "@/lib/prisma";

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

export type CustomerStatement = {
  customerId: string;
  customerName: string;
  companyName: string | null;
  properties: StatementProperty[];
  totalDueCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
  openInvoiceCount: number;
};

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
        },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  if (!customer) return null;

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

    const balanceCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
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
    group.totalDueCents += invoice.amountDueCents;
    group.totalPaidCents += invoice.amountPaidCents;
    group.totalBalanceCents += balanceCents;
  }

  const properties = Array.from(groups.values()).sort((a, b) =>
    a.addressLabel.localeCompare(b.addressLabel),
  );

  const openInvoiceCount = customer.invoices.filter((inv) =>
    ["OPEN", "PARTIALLY_PAID", "DELINQUENT"].includes(inv.status),
  ).length;

  return {
    customerId: customer.id,
    customerName: customer.user.name ?? customer.user.email,
    companyName: customer.companyName,
    properties,
    totalDueCents: properties.reduce((s, p) => s + p.totalDueCents, 0),
    totalPaidCents: properties.reduce((s, p) => s + p.totalPaidCents, 0),
    totalBalanceCents: properties.reduce((s, p) => s + p.totalBalanceCents, 0),
    openInvoiceCount,
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
