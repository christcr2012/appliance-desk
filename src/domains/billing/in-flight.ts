// BILL-1: bank payments the bank is still confirming ("Being confirmed").
// A BankPaymentInFlight row is ONLY a flag: "the bank is confirming a payment of $X for this bill". It is never money
// received and changes no total, book entry, receipt or what the customer owes. This file is the one place that says
// what "in flight" means; every reader (Bills, To do, reminders, late fees) uses these two filters.
// Spec: docs/build-specs/engines/BANK-PAYMENTS-IN-FLIGHT.md. Keep this file free of webhook/Stripe imports so any
// screen or rule can import it; the writers are in in-flight-writers.ts and the nightly check in in-flight-check.ts.
import type { Prisma } from "@prisma/client";

/** A bill with at least one bank payment the bank is still confirming. */
export const inFlightWhere = {
  bankPaymentsInFlight: { some: { clearedAt: null } },
} satisfies Prisma.InvoiceWhereInput;

/** A bill with no bank payment being confirmed. */
export const notInFlightWhere = {
  bankPaymentsInFlight: { none: { clearedAt: null } },
} satisfies Prisma.InvoiceWhereInput;

/** Owner setting `bankPaymentSlowBusinessDays`: banking days before a bank payment goes on To do. Banks usually take up to 4. */
export const BANK_PAYMENT_SLOW_DAYS_DEFAULT = 6;
export const BANK_PAYMENT_SLOW_DAYS_MIN = 2;
export const BANK_PAYMENT_SLOW_DAYS_MAX = 20;

export type BankPaymentClearReason = "SUCCEEDED" | "FAILED" | "CANCELED" | "INVOICE_CLOSED";
export type BankPaymentSource = "STRIPE_INVOICE" | "LOCAL_CHECKOUT";

/** Validate the owner's slow-payment number (a whole number from 2 to 20). */
export function validateBankPaymentSlowDays(value: number): number {
  if (!Number.isInteger(value) || value < BANK_PAYMENT_SLOW_DAYS_MIN || value > BANK_PAYMENT_SLOW_DAYS_MAX) {
    throw new Error(`Choose a whole number of banking days from ${BANK_PAYMENT_SLOW_DAYS_MIN} to ${BANK_PAYMENT_SLOW_DAYS_MAX}.`);
  }
  return value;
}
