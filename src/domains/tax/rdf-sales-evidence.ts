import type { Prisma } from "@prisma/client";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

type Tx = Prisma.TransactionClient;

const EXCLUDED_KINDS = [
  "DEPOSIT", "TAX", "RETAIL_DELIVERY_FEE", "CREDIT", "PREPAY_DISCOUNT", "LATE_RETURN_WAIVER",
] as const;
const EXCLUDED_STATUSES = ["DRAFT", "VOID", "WRITTEN_OFF"] as const;
const RETURNED_REFUND_STATES = ["RETURNED_STRIPE_TEST_VERIFIED", "RETURNED_MANUAL_RECORDED"] as const;

export type CountedInvoice = {
  invoiceId: string;
  agreementId: string | null;
  issuedAt: Date;
  cents: number;
};

/**
 * One row per counted Colorado invoice for the year, in issue order, net of
 * refunds for sales cancelled before delivery. This is the single counting
 * rule behind both the yearly total and the threshold-crossing walk: rent and
 * goods count (the careful choice; see the RDF-RENT-COUNTS question), tax,
 * deposits, credits and the fee itself never do, and a voided bill is out.
 */
async function countedInvoices(tx: Tx, year: number): Promise<CountedInvoice[]> {
  const window = {
    gte: businessDateFromKey(`${year}-01-01`)!,
    lt: businessDateFromKey(`${year + 1}-01-01`)!,
  };
  const lineSelect = {
    amountCents: true, invoiceId: true,
    invoice: { select: { issuedAt: true, agreementId: true } },
  } as const;
  const [rentalLines, shopLines] = await Promise.all([
    tx.invoiceLineItem.findMany({
      where: {
        kind: { notIn: [...EXCLUDED_KINDS] },
        invoice: {
          agreement: { serviceAddress: { state: "CO" } },
          status: { notIn: [...EXCLUDED_STATUSES] },
          issuedAt: window,
        },
      },
      select: lineSelect,
    }),
    tx.invoiceLineItem.findMany({
      where: {
        kind: { notIn: [...EXCLUDED_KINDS] },
        invoice: { saleKind: "SHOP_SALE", status: { notIn: [...EXCLUDED_STATUSES] }, issuedAt: window },
      },
      select: {
        ...lineSelect,
        invoice: { select: { issuedAt: true, agreementId: true, saleServiceAddressId: true } },
      },
    }),
  ]);
  // Shop sales: picked up at the shop (Colorado) or delivered to a Colorado address.
  const addressIds = [...new Set(shopLines.flatMap((l) => (l.invoice.saleServiceAddressId ? [l.invoice.saleServiceAddressId] : [])))];
  const outside = new Set(
    addressIds.length ? (await tx.serviceAddress.findMany({ where: { id: { in: addressIds }, state: { not: "CO" } }, select: { id: true } })).map((a) => a.id) : [],
  );
  const byInvoice = new Map<string, CountedInvoice>();
  const add = (invoiceId: string, agreementId: string | null, issuedAt: Date, cents: number) => {
    const row = byInvoice.get(invoiceId) ?? { invoiceId, agreementId, issuedAt, cents: 0 };
    row.cents += cents;
    byInvoice.set(invoiceId, row);
  };
  for (const line of rentalLines) {
    if (!line.invoice.issuedAt) continue; // the window query already excludes these
    add(line.invoiceId, line.invoice.agreementId, line.invoice.issuedAt, line.amountCents);
  }
  for (const line of shopLines) {
    if (line.invoice.saleServiceAddressId && outside.has(line.invoice.saleServiceAddressId)) continue;
    if (!line.invoice.issuedAt) continue;
    add(line.invoiceId, line.invoice.agreementId, line.invoice.issuedAt, line.amountCents);
  }
  const invoices = [...byInvoice.values()].sort(
    (a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.invoiceId.localeCompare(b.invoiceId),
  );
  // A sale cancelled before delivery is not a sale: subtract what was actually
  // refunded, against that agreement's invoices in the order they were issued,
  // never more than those invoices counted.
  const cancellations = await tx.preDeliveryCancellation.findMany({
    where: { refundState: { in: [...RETURNED_REFUND_STATES] }, refundDueCents: { gt: 0 } },
    select: { agreementId: true, refundDueCents: true },
  });
  for (const cancellation of cancellations) {
    let remaining = cancellation.refundDueCents;
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      if (invoice.agreementId !== cancellation.agreementId) continue;
      const cut = Math.min(remaining, Math.max(0, invoice.cents));
      invoice.cents -= cut;
      remaining -= cut;
    }
  }
  return invoices;
}

/** Count one issued Colorado retail invoice line once, never one per tax jurisdiction. */
export async function recordedRetailSales(tx: Tx, year: number): Promise<number> {
  const invoices = await countedInvoices(tx, year);
  const total = invoices.reduce((sum, invoice) => sum + invoice.cents, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("Sales total is outside integer cents range.");
  return Math.max(0, total);
}

/**
 * Walk the year's counted invoices in issue order and return the first one
 * whose running total passes the threshold, with its Denver business date.
 * Null when the year never passes it (reaching it exactly is not passing).
 */
export async function findRdfThresholdCrossing(
  tx: Tx, year: number, thresholdCents: number,
): Promise<{ crossedOn: Date; invoiceId: string } | null> {
  if (!Number.isSafeInteger(thresholdCents) || thresholdCents < 0)
    throw new Error("Threshold must be nonnegative whole cents.");
  const invoices = await countedInvoices(tx, year);
  let running = 0;
  for (const invoice of invoices) {
    running += invoice.cents;
    if (running > thresholdCents) {
      const crossedOn = businessDateFromKey(businessDateKey(invoice.issuedAt));
      if (!crossedOn) throw new Error("Invalid crossing day.");
      return { crossedOn, invoiceId: invoice.invoiceId };
    }
  }
  return null;
}
