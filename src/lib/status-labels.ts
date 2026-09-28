/**
 * Plain-English labels for the database's internal status/type codes,
 * for anywhere a CUSTOMER sees one (the owner desk's staff can read
 * "AWAITING_SIGNATURE" fine — this is specifically for /account/**,
 * per the design review's finding, 2026-09-27: customers were seeing
 * raw codes like "AWAITING_SIGNATURE" instead of a real sentence,
 * which reads like unfinished software).
 *
 * Deliberately just a lookup table, not a database change — the enum
 * values themselves stay exactly as Prisma/the rest of the app already
 * use them (see prisma/schema.prisma); this only changes what's shown
 * on screen.
 */

const RENTAL_AGREEMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Being set up",
  AWAITING_SIGNATURE: "Waiting on your signature",
  ACTIVE: "Active",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const JOB_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  INSTALLATION: "Installation",
  SWAP: "Swap",
  MAINTENANCE_VISIT: "Maintenance visit",
  REMOVAL: "Pickup / removal",
};

const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  REVIEWING: "Being reviewed",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Being prepared",
  OPEN: "Open",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  FAILED: "Payment failed",
  VOID: "Voided",
  DELINQUENT: "Past due",
  WRITTEN_OFF: "Written off",
  REFUNDED: "Refunded",
};

function lookup(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

export const rentalAgreementStatusLabel = (status: string) =>
  lookup(RENTAL_AGREEMENT_STATUS_LABELS, status);

export const jobStatusLabel = (status: string) => lookup(JOB_STATUS_LABELS, status);

export const jobTypeLabel = (type: string) => lookup(JOB_TYPE_LABELS, type);

export const maintenanceStatusLabel = (status: string) =>
  lookup(MAINTENANCE_STATUS_LABELS, status);

export const invoiceStatusLabel = (status: string) => lookup(INVOICE_STATUS_LABELS, status);
