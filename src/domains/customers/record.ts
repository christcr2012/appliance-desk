// AR-0b: read-only data for the customer record page (docs/build-specs/screens/CUSTOMER-RECORD.md section 3).
// Owners and admins only: every exported read checks the role before touching the database.
import type { RentalAgreementStatus } from "@prisma/client";
import type { Tone } from "@/components/kit/types";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessDayBounds, formatShortDate, ordinal } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { billOwedWhere, pastDueInvoiceWhere } from "@/domains/billing/bill-status";
import { SUCCESSFUL_PAYMENT_STATUSES } from "@/domains/billing/payment-status";
import { getNextBills, rentForNextBill } from "@/domains/portal/next-bill";
import {
  OVERDUE_JOB_TODO_SELECT,
  PAST_DUE_TODO_ORDER,
  PAST_DUE_TODO_SELECT,
  UNREVIEWED_REQUEST_TODO_SELECT,
  markTodoItems,
  overdueJobTodoItems,
  overdueJobTodoWhere,
  pastDueTodoItem,
  pastDueTodoWhere,
  unreviewedRequestTodoItems,
  unreviewedRequestTodoWhere,
  type ExceptionItem,
} from "@/domains/exceptions";
import { sortInbox } from "@/domains/exceptions/inbox";
import { listUnsignedAgreements } from "@/domains/exceptions/unsigned-agreements";
import { listSignedDeliveryAttention } from "@/domains/exceptions/signed-delivery-attention";
import { listRentalEndingSoon, listPickupUnscheduled } from "@/domains/exceptions/turning-points-attention";
import { listSigningPaymentAttention } from "@/domains/exceptions/signing-payment-attention";
import { listDepositDecisionAttention } from "@/domains/exceptions/money-turning-points";

export type CustomerStatus = "active" | "upcoming" | "past" | "new" | "archived";

export type CustomerSummary = {
  status: CustomerStatus;
  customerSince: Date;
  city: string | null;
  primaryAddress: string | null;
  monthlyRentCents: number;
  owedCents: number;
  oldestOpenBillId: string | null;
  nextBill: { date: Date; rentCents: number } | null;
  autopay: boolean;
  renting: string | null;
  onTime: { paidOnTime: number; counted: number } | null;
  hasPortalLogin: boolean;
  /** Rentals that are on, starting soon or waiting for a signature (the Rentals tab count). */
  liveRentalCount: number;
};

export const CUSTOMER_STATUS_PILL: Record<CustomerStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "good" },
  upcoming: { label: "Starting soon", tone: "info" },
  past: { label: "Past customer", tone: "neutral" },
  new: { label: "New", tone: "info" },
  archived: { label: "Archived", tone: "neutral" },
};

/** First match wins: archived, any active rental, any starting soon, any ended, else new. */
export function customerStatus(input: { archivedAt: Date | null; agreementStatuses: RentalAgreementStatus[] }): CustomerStatus {
  if (input.archivedAt) return "archived";
  const has = (status: RentalAgreementStatus) => input.agreementStatuses.includes(status);
  if (has("ACTIVE")) return "active";
  if (has("SCHEDULED") || has("AWAITING_SIGNATURE")) return "upcoming";
  if (has("ENDED")) return "past";
  return "new";
}

/** "Washer", "Washer + dryer", "3 appliances", or null when nothing is rented. */
export function rentingText(typeNames: string[]): string | null {
  const names = [...new Set(typeNames.map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1].toLowerCase()}`;
  return `${names.length} appliances`;
}

/** A rental line's appliance names: its assigned machines, or its label up to " @ " before anything is assigned. */
export function lineTypeNames(line: { label: string; assignments: { appliance: { applianceType: { name: string } } }[] }): string[] {
  if (line.assignments.length > 0) return line.assignments.map((a) => a.appliance.applianceType.name);
  const name = line.label.split(" @ ")[0]?.trim();
  return name ? [name] : [];
}

type Settlement = { at: Date; amountCents: number };

/**
 * When a bill became fully paid: the first date at which its successful payments (dated by the day the money arrived)
 * plus applied account credit reach the amount due. Null when they never do.
 */
export function settledAt(amountDueCents: number, settlements: Settlement[]): Date | null {
  let total = 0;
  for (const entry of [...settlements].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    total += entry.amountCents;
    if (total >= amountDueCents) return entry.at;
  }
  return null;
}

/**
 * Of the bills given (newest due first, at most 7), how many were paid by the end of their due day in Colorado. An
 * unpaid bill counts as late. Null when fewer than 3 bills count (the stat is hidden).
 */
export function onTimeRecord(bills: { dueDate: Date | null; paidAt: Date | null }[]): { paidOnTime: number; counted: number } | null {
  const counted = bills.filter((bill) => bill.dueDate).slice(0, 7);
  if (counted.length < 3) return null;
  const paidOnTime = counted.filter((bill) => bill.paidAt && bill.paidAt.getTime() <= businessDayBounds(bill.dueDate!).end.getTime()).length;
  return { paidOnTime, counted: counted.length };
}

/** Owner words for a rental's status (not the customer-facing wording). */
export const AGREEMENT_PILL: Record<RentalAgreementStatus, (startDate: Date | null, now: Date) => { label: string; tone: Tone }> = {
  DRAFT: () => ({ label: "Draft", tone: "neutral" }),
  AWAITING_SIGNATURE: () => ({ label: "Waiting for signature", tone: "info" }),
  SCHEDULED: (startDate, now) => ({ label: startDate ? `Starts ${formatShortDate(startDate, now)}` : "Starting soon", tone: "info" }),
  ACTIVE: () => ({ label: "Active", tone: "good" }),
  ENDED: () => ({ label: "Ended", tone: "neutral" }),
  CANCELLED: () => ({ label: "Cancelled", tone: "neutral" }),
};

export type RentalBillingLine =
  | { kind: "blocked"; text: string; href: string }
  | { kind: "automatic"; text: string }
  | { kind: "not-started"; text: string };

/** What the record says about an active rental's monthly billing. It only reports what is stored. */
export function rentalBillingLine(input: {
  agreementId: string;
  billingBlockedReason: string | null;
  stripeSubscriptionId: string | null;
  nextBillingDate: Date | null;
  rentCents: number;
  autopay: boolean;
}): RentalBillingLine {
  if (input.billingBlockedReason) {
    return { kind: "blocked", text: "Monthly billing isn't running for this rental.", href: `/desk/agreements/${encodeURIComponent(input.agreementId)}` };
  }
  if (input.stripeSubscriptionId && input.nextBillingDate) {
    const day = ordinal(Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", day: "numeric" }).format(input.nextBillingDate)));
    const rent = formatMoney(input.rentCents);
    return {
      kind: "automatic",
      text: input.autopay
        ? `Automatic: ${rent} is billed and charged to the card on file on the ${day} of each month.`
        : `Automatic: a ${rent} bill is made on the ${day} of each month.`,
    };
  }
  return { kind: "not-started", text: "Monthly billing hasn't started yet." };
}

export async function getCustomerSummary(customerId: string, now = new Date()): Promise<CustomerSummary> {
  await requireRole("OWNER", "ADMIN");
  const owedWhere = { AND: [billOwedWhere(now), { customerId }] };
  const [customer, agreements, owed, oldestOpen, nextBills, recentBills] = await Promise.all([
    prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        createdAt: true,
        archivedAt: true,
        stripeDefaultPaymentMethodId: true,
        serviceAddresses: { select: { line1: true, city: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1 },
      },
    }),
    prisma.rentalAgreement.findMany({
      where: { customerId },
      select: {
        status: true,
        lines: {
          select: {
            label: true,
            monthlyPriceCents: true,
            assignments: { where: { unassignedAt: null }, select: { appliance: { select: { applianceType: { select: { name: true } } } } } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.invoice.aggregate({ where: owedWhere, _sum: { amountDueCents: true, amountPaidCents: true } }),
    prisma.invoice.findFirst({
      where: owedWhere,
      select: { id: true },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { invoiceNumber: "asc" }],
    }),
    getNextBills(customerId),
    prisma.invoice.findMany({
      where: { customerId, dueDate: { not: null }, OR: [{ status: "PAID" }, pastDueInvoiceWhere(now)] },
      select: {
        status: true,
        dueDate: true,
        amountDueCents: true,
        payments: {
          where: { status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] } },
          select: { amountCents: true, createdAt: true, receipt: { select: { receivedOn: true } } },
        },
        creditApplications: { select: { amountCents: true, createdAt: true } },
      },
      orderBy: [{ dueDate: "desc" }, { invoiceNumber: "desc" }],
      take: 7,
    }),
  ]);

  const active = agreements.filter((a) => a.status === "ACTIVE");
  const address = customer.serviceAddresses[0] ?? null;
  const onTimeBills = recentBills.flatMap((bill): { dueDate: Date | null; paidAt: Date | null }[] => {
    if (bill.status !== "PAID") return [{ dueDate: bill.dueDate, paidAt: null }];
    const paidAt = settledAt(bill.amountDueCents, [
      ...bill.payments.map((p) => ({ at: p.receipt?.receivedOn ?? p.createdAt, amountCents: p.amountCents })),
      ...bill.creditApplications.map((c) => ({ at: c.createdAt, amountCents: c.amountCents })),
    ]);
    return paidAt ? [{ dueDate: bill.dueDate, paidAt }] : []; // never reached the amount due: inconsistent, skip
  });
  const next = nextBills[0] ?? null;
  return {
    status: customerStatus({ archivedAt: customer.archivedAt, agreementStatuses: agreements.map((a) => a.status) }),
    customerSince: customer.createdAt,
    city: address?.city ?? null,
    primaryAddress: address ? `${address.line1}, ${address.city}` : null,
    monthlyRentCents: active.reduce((sum, a) => sum + rentForNextBill(a.lines), 0),
    owedCents: Math.max(0, (owed._sum.amountDueCents ?? 0) - (owed._sum.amountPaidCents ?? 0)),
    oldestOpenBillId: oldestOpen?.id ?? null,
    nextBill: next ? { date: next.date, rentCents: next.rentCents } : null,
    autopay: customer.stripeDefaultPaymentMethodId != null,
    renting: rentingText(active.flatMap((a) => a.lines.flatMap(lineTypeNames))),
    onTime: onTimeRecord(onTimeBills),
    // The record has always offered "Resend account email" for every customer; it reports why it can't send.
    hasPortalLogin: true,
    liveRentalCount: agreements.filter((a) => ["ACTIVE", "SCHEDULED", "AWAITING_SIGNATURE"].includes(a.status)).length,
  };
}

/**
 * Up to three things to do for this customer, read for this customer only (so the business-wide To do cap never hides
 * them), with the same item builders and snooze handling as Today. Snoozed items are left out.
 */
export async function getCustomerNextSteps(customerId: string, now = new Date()): Promise<ExceptionItem[]> {
  await requireRole("OWNER", "ADMIN");
  const scope = { customerId };
  const [pastDue, overdueJobs, unreviewed, unsigned, delivery, ending, pickup, signing, deposits] = await Promise.all([
    prisma.invoice.findMany({
      where: { AND: [pastDueTodoWhere(now), { customerId }] },
      select: PAST_DUE_TODO_SELECT,
      orderBy: PAST_DUE_TODO_ORDER,
      take: 3,
    }),
    prisma.job.findMany({
      where: { AND: [overdueJobTodoWhere(now), { customerId }] },
      select: OVERDUE_JOB_TODO_SELECT,
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 3,
    }),
    prisma.maintenanceRequest.findMany({
      where: { AND: [unreviewedRequestTodoWhere(now), { customerId }] },
      select: UNREVIEWED_REQUEST_TODO_SELECT,
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      take: 3,
    }),
    listUnsignedAgreements(3, now, scope),
    listSignedDeliveryAttention(3, scope),
    listRentalEndingSoon(3, now, scope),
    listPickupUnscheduled(3, scope),
    listSigningPaymentAttention(3, scope),
    listDepositDecisionAttention(3, now, scope),
  ]);
  const items: ExceptionItem[] = [
    ...pastDue.map(pastDueTodoItem),
    ...overdueJobTodoItems(overdueJobs),
    ...unreviewedRequestTodoItems(unreviewed),
    ...unsigned.rows,
    ...delivery.rows,
    ...ending.rows,
    ...pickup.rows,
    ...signing.rows,
    ...deposits.rows,
  ];
  const marked = await markTodoItems(items, now, true);
  return sortInbox(marked.items).slice(0, 3);
}
