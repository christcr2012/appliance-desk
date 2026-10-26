import { prisma } from "@/lib/prisma";
import { getBusinessSettings } from "@/domains/settings";

// ---------------------------------------------------------------------------
// A single, printable invoice document (2026-09-29, brand kit v2.0
// "Evergreen" phase 3 — see docs/DECISIONS.md). Everything in
// statements.ts is a ROLLUP — a customer's whole billing picture across
// however many properties and invoices they have. This is the opposite:
// one invoice, on its own, laid out like a real business document
// (Chris asked for something "like Jobber's" invoices) — logo and
// business info, a bill-to block, the line items, and the totals. Reuses
// the same underlying Invoice/InvoiceLineItem data that feeds the
// rollup, just shaped for a single document instead of a list.
// ---------------------------------------------------------------------------

export type LateFeeStanding =
  | { state: "WILL_BE_ADDED"; feeCents: number; feeDate: Date }
  | { state: "RECORDED"; chargeId: string; feeCents: number }
  | { state: "BILLED"; chargeId: string; feeCents: number; onBillNumber: number | null; waivable: boolean }
  | { state: "WAIVED"; feeCents: number; reason: string }
  | { state: "NOT_WARNED" }
  | { state: "MILITARY" };

export type InvoiceDetail = {
  id: string;
  invoiceNumber: number;
  status: string;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  dueDate: Date | null;
  createdAt: Date;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  lateFeeCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  balanceCents: number;
  /** BILL-1: money the bank is still confirming for this bill (not received; the customer still owes it until it clears). 0 when none. */
  beingConfirmedCents: number;
  /** FEE-1: where this bill stands on a late fee. Staff view only (null for the customer portal). */
  lateFee: LateFeeStanding | null;
  isLocalInvoice: boolean;
  /** A counter sale (shop sale): the one kind of local invoice that can be paid by card online. */
  isShopSale: boolean;
  lineItems: { id: string; kind: string; description: string; amountCents: number; quantity: number }[];
  payments: {
    id: string;
    amountCents: number;
    method: string | null;
    status: string;
    createdAt: Date;
  }[];
  customer: {
    id: string;
    name: string;
    companyName: string | null;
    email: string;
  };
  propertyAddress: string | null;
  business: {
    name: string;
    phone: string;
    email: string;
    address: string;
    logoUrl: string | null;
  };
};

function addressLabel(a: { line1: string; line2: string | null; city: string; state: string; zip: string } | null): string | null {
  if (!a) return null;
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`;
}

/**
 * One invoice, fully laid out for display/printing. Returns null if the
 * invoice doesn't exist, OR — when `customerId` is passed — if it exists
 * but belongs to someone else. Every caller from the customer portal
 * MUST pass the signed-in customer's own id here; this is the only
 * thing standing between a customer and someone else's invoice, same
 * customer-data-isolation rule as everywhere else in this app (see
 * tests/customer-isolation.test.ts for the pattern this follows). The
 * desk side (Chris/staff) omits `customerId` since OWNER/ADMIN can
 * legitimately look at any customer's invoice.
 */
export async function getInvoiceDetail(
  invoiceId: string,
  options?: { customerId?: string },
): Promise<InvoiceDetail | null> {
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: { orderBy: [{ createdAt: "asc" }] },
        payments: { orderBy: [{ createdAt: "asc" }] },
        customer: { select: { id: true, companyName: true, user: { select: { name: true, email: true } } } },
        agreement: { select: { serviceAddress: true } },
        bankPaymentsInFlight: { where: { clearedAt: null }, select: { amountCents: true } },
        pendingChargesFor: { select: { id: true, amountCents: true, appliedToInvoice: { select: { invoiceNumber: true } }, appliedToInvoiceId: true, waivedAt: true, waivedReason: true } },
      },
    }),
    getBusinessSettings(),
  ]);

  if (!invoice) return null;
  if (options?.customerId && invoice.customerId !== options.customerId) return null;
  if (options?.customerId && invoice.status === "DRAFT") return null;

  const balanceCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  let lateFee: LateFeeStanding | null = null;
  if (!options?.customerId) {
    const charge = invoice.pendingChargesFor[0];
    if (charge) {
      if (charge.waivedAt) lateFee = { state: "WAIVED", feeCents: charge.amountCents, reason: charge.waivedReason ?? "" };
      else if (charge.appliedToInvoiceId) lateFee = { state: "BILLED", chargeId: charge.id, feeCents: charge.amountCents, onBillNumber: charge.appliedToInvoice?.invoiceNumber ?? null, waivable: true };
      else lateFee = { state: "RECORDED", chargeId: charge.id, feeCents: charge.amountCents };
    } else if (invoice.agreementId) {
      const { loadLateFeeFacts } = await import("./late-fee-engine");
      const { decideLateFee } = await import("./late-fee-rules");
      const loaded = await loadLateFeeFacts(prisma, invoice.id, new Date());
      if (loaded) {
        const decision = decideLateFee(loaded.facts);
        if (decision.kind === "NEEDS_WARNING") lateFee = { state: "NOT_WARNED" };
        else if (decision.kind === "MILITARY_REVIEW" && loaded.facts.todayKey >= loaded.baseKey) lateFee = { state: "MILITARY" };
        else if (invoice.lateFeeDate && loaded.facts.warnedKey && (decision.kind === "WAIT")) {
          lateFee = { state: "WILL_BE_ADDED", feeCents: loaded.facts.feeCents, feeDate: invoice.lateFeeDate };
        }
      }
    }
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    billingPeriodStart: invoice.billingPeriodStart,
    billingPeriodEnd: invoice.billingPeriodEnd,
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt,
    subtotalCents: invoice.subtotalCents,
    discountCents: invoice.discountCents,
    taxCents: invoice.taxCents,
    lateFeeCents: invoice.lateFeeCents,
    amountDueCents: invoice.amountDueCents,
    amountPaidCents: invoice.amountPaidCents,
    balanceCents,
    beingConfirmedCents: balanceCents > 0 ? invoice.bankPaymentsInFlight.reduce((sum, row) => sum + row.amountCents, 0) : 0,
    lateFee,
    isLocalInvoice: invoice.stripeInvoiceId === null,
    isShopSale: invoice.saleKind === "SHOP_SALE",
    lineItems: invoice.lineItems.map((li) => ({
      id: li.id,
      kind: li.kind,
      description: li.description,
      amountCents: li.amountCents,
      quantity: li.quantity,
    })),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt,
    })),
    customer: {
      id: invoice.customer.id,
      name: invoice.customer.user.name ?? invoice.customer.user.email,
      companyName: invoice.customer.companyName,
      email: invoice.customer.user.email,
    },
    propertyAddress: addressLabel(invoice.agreement?.serviceAddress ?? null),
    business: {
      name: settings.publicBusinessName,
      phone: settings.publicPhone,
      email: settings.publicEmail,
      address: settings.publicAddress,
      logoUrl: settings.logoUrl,
    },
  };
}
