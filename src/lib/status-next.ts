// AR-12: every desk status says what actually happens next. No fake reminder or payment promises.
import { businessDaysBetween } from "@/lib/business-date";
import type { InvoiceStatus, RentalAgreementStatus, JobStatus } from "@prisma/client";

export type BillPillKey = "open" | "past-due" | "being-confirmed" | "payment-failed" | "paid" | "given-up" | "cancelled" | "refunded" | "draft";

export const STATUS_NEXT = {
  bill: {
    open: "Waiting for payment.",
    "past-due": "Late. Take payment or send a reminder.",
    "being-confirmed": "The bank is confirming this payment. Nothing to do.",
    "payment-failed": "The card was refused. Take payment again or send a reminder.",
    paid: "Paid in full. Nothing to do.",
    "given-up": "You chose not to collect this bill.",
    cancelled: "Cancelled. Nothing is owed.",
    refunded: "Money was sent back to the customer.",
    draft: "Not sent yet. Send it when it's ready.",
  } satisfies Record<BillPillKey, string>,
  rental: {
    DRAFT: "Not sent yet. Finish it and send it for signing.",
    AWAITING_SIGNATURE: "Waiting for the customer to sign.",
    SCHEDULED: "Signed. It starts on its start date.",
    ACTIVE: "Renting now.",
    ENDED: "Finished. Make sure the appliances came back.",
    CANCELLED: "Cancelled before it started.",
  } satisfies Record<RentalAgreementStatus, string>,
  visit: {
    SCHEDULED: "Booked.",
    IN_PROGRESS: "Happening now.",
    COMPLETED: "Done.",
    CANCELLED: "Cancelled. Nothing to do.",
  } satisfies Record<JobStatus, string>,
};

export type BillStatusInput = {
  status: InvoiceStatus;
  dueDate: Date | null;
  amountDueCents: number;
  amountPaidCents: number;
  beingConfirmed?: boolean;
};

/** Match the existing bill pill: completed records first, confirmation before failure, then Colorado lateness. */
export function billNextKey(bill: BillStatusInput, now: Date): BillPillKey {
  switch (bill.status) {
    case "DRAFT": return "draft";
    case "VOID": return "cancelled";
    case "PAID": return "paid";
    case "WRITTEN_OFF": return "given-up";
    case "REFUNDED": return "refunded";
  }
  if (bill.amountDueCents <= bill.amountPaidCents) return "paid";
  if (bill.beingConfirmed) return "being-confirmed";
  if (bill.status === "FAILED") return "payment-failed";
  if (bill.dueDate && businessDaysBetween(bill.dueDate, now) > 0) return "past-due";
  return "open";
}

export function billNext(bill: BillStatusInput, now: Date): string {
  return STATUS_NEXT.bill[billNextKey(bill, now)];
}
