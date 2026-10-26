// AR-0b: the one set of bill status rules every money screen shares (docs/build-specs/screens/MONEY-BILLS.md section 2).
// Read-only predicates and words: nothing here writes a bill, moves money or decides how a bill is paid.
import type { InvoiceStatus, Prisma } from "@prisma/client";
import type { Tone } from "@/components/kit/types";
import { prisma } from "@/lib/prisma";
import { businessDayBounds, businessDaysBetween, formatShortDate } from "@/lib/business-date";
import { inFlightWhere, notInFlightWhere } from "./in-flight";

// BILL-1: "being-confirmed" = open bills whose bank payment the bank is still confirming. Not money received, and the
// customer still owes it (it stays in billOwedWhere); it only leaves the Open / Past due tabs and all chasing work.
export type BillTab = "open" | "past-due" | "being-confirmed" | "paid" | "closed" | "drafts";
export const BILL_TABS: readonly BillTab[] = ["open", "past-due", "being-confirmed", "paid", "closed", "drafts"];

/** Bills that still ask the customer for money (a FAILED row is kept visible so it is never lost). */
export const OPEN_BILL_STATUSES = ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"] as const satisfies readonly InvoiceStatus[];
export const CLOSED_BILL_STATUSES = ["VOID", "WRITTEN_OFF", "REFUNDED"] as const satisfies readonly InvoiceStatus[];

/** The open rule: an open status AND money still owed (amount due greater than amount paid). */
function openRule(): Prisma.InvoiceWhereInput {
  return {
    status: { in: [...OPEN_BILL_STATUSES] },
    amountDueCents: { gt: prisma.invoice.fields.amountPaidCents },
  };
}

/**
 * Past due: open, the due date is before the start of today in Colorado — a bill due today is not late yet — and no bank
 * payment is being confirmed (BILL-1: such a bill shows "Being confirmed" instead of late).
 * Today's health strip, the Bills "Past due" tab, the revenue dashboard and the customer's on-time record all use this.
 */
export function pastDueInvoiceWhere(now: Date): Prisma.InvoiceWhereInput {
  return { ...openRule(), ...notInFlightWhere, dueDate: { lt: businessDayBounds(now).start } };
}

/**
 * Every bill still owed, INCLUDING bills whose bank payment is being confirmed (the customer owes it until the bank
 * says it arrived). Money totals ("Owes now", Money overview, statements, "Take payment") use this, never a tab filter.
 */
export function billOwedWhere(_now: Date): Prisma.InvoiceWhereInput {
  void _now; // the signature already takes `now` so a later rule can use it
  return openRule();
}

export function billTabWhere(tab: BillTab, now: Date): Prisma.InvoiceWhereInput {
  switch (tab) {
    case "open":
      return { ...openRule(), ...notInFlightWhere };
    case "past-due":
      return pastDueInvoiceWhere(now);
    case "being-confirmed":
      return { ...openRule(), ...inFlightWhere };
    case "paid":
      return { status: "PAID" };
    case "closed":
      return { status: { in: [...CLOSED_BILL_STATUSES] } };
    case "drafts":
      return { status: "DRAFT" };
  }
}

type PillInput = {
  status: InvoiceStatus;
  dueDate: Date | null;
  amountDueCents: number;
  amountPaidCents: number;
  /** BILL-1: the bank is confirming a payment for this bill. */
  beingConfirmed?: boolean;
};

function isOpen(bill: PillInput): boolean {
  return (OPEN_BILL_STATUSES as readonly string[]).includes(bill.status) && bill.amountDueCents > bill.amountPaidCents;
}

/** The status word on a bill (first match wins; finished bills first). */
export function billPill(bill: PillInput, now: Date): { label: string; tone: Tone } {
  switch (bill.status) {
    case "PAID":
      return { label: "Paid", tone: "good" };
    case "VOID":
      return { label: "Cancelled", tone: "neutral" };
    case "WRITTEN_OFF":
      return { label: "Given up", tone: "neutral" };
    case "REFUNDED":
      return { label: "Refunded", tone: "neutral" };
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
  }
  if (!isOpen(bill)) return { label: "Paid", tone: "good" };
  if (bill.beingConfirmed) return { label: "Being confirmed", tone: "info" };
  if (bill.status === "FAILED") return { label: "Check this bill", tone: "attention" };
  if (!bill.dueDate) return { label: "Open", tone: "neutral" };
  const late = businessDaysBetween(bill.dueDate, now);
  if (late > 0) return { label: `${late} ${late === 1 ? "day" : "days"} late`, tone: "attention" };
  if (late === 0) return { label: "Due today", tone: "neutral" };
  return { label: `Due ${formatShortDate(bill.dueDate, now)}`, tone: "neutral" };
}

/** Which glossary entry explains a pill, when one does. */
export function billPillInfo(status: InvoiceStatus, beingConfirmed = false): "bill-failed" | "bill-given-up" | "bill-processing" | undefined {
  if (beingConfirmed && (OPEN_BILL_STATUSES as readonly string[]).includes(status)) return "bill-processing";
  return status === "FAILED" ? "bill-failed" : status === "WRITTEN_OFF" ? "bill-given-up" : undefined;
}

export type PayPath = "STRIPE_LINK" | "SHOP_CARD" | "MANUAL_ONLY";

/**
 * How a bill can be paid from the Bills screen, or null when there is nothing to collect. A FAILED bill gets no pay
 * button: no code sets FAILED today (a failed Stripe payment sets DELINQUENT), so a FAILED row is old data to open and check.
 */
export function payPathFor(b: {
  status: InvoiceStatus;
  owedCents: number;
  stripeInvoiceId: string | null;
  saleKind: string | null;
}): PayPath | null {
  if (!(OPEN_BILL_STATUSES as readonly string[]).includes(b.status) || b.owedCents <= 0) return null;
  if (b.status === "FAILED") return null;
  if (b.stripeInvoiceId) return "STRIPE_LINK";
  if (b.saleKind === "SHOP_SALE") return "SHOP_CARD";
  return "MANUAL_ONLY";
}
