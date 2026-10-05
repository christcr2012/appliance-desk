import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateFromKey, businessDateKey, businessDayBounds, businessDaysBetween, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { sumTax, taxCentsForLine } from "./tax";
import { prepareInvoiceRefundInTx, runPreparedInvoiceRefund, type ClaimedRefund } from "./refunds";
import { lockCustomerLedger } from "./ledger";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { closeAgreementInTx, lockRentalAgreementInTx, runCloseAgreementContinuation, type CloseAgreementResult } from "@/domains/agreements";
import { dropSubstituteInTx } from "@/domains/jobs/substitution";
import { claimLineReductionInTx, lineReduceKey, runLineReduction, type LineReduceClaim } from "./subscription-line";
import { claimProviderOperation, completeProviderOperation, RetryLater, runProviderCall } from "./provider-ops";
import {
  LATE_DELIVERY_CREDIT_SOURCE,
  NEVER_DELIVERED_UNASSIGN_REASON,
  billingPeriodContaining,
  calculateLateDeliveryCredit,
  calculateLateReturnCharge,
  itemMonthlyPriceCents,
  periodsBilledThrough,
  pickupBillingSettingsFrom,
  type PickupBillingSettings,
} from "./pickup-billing";

/**
 * What a completed job does to billing (owner decisions IN-24 / IN-26 / IN-27,
 * 2026-10-03). Everything here is called inside the job-completion transaction
 * with the appliances the job actually moved, so it runs exactly once per
 * appliance: a job completes once, and an appliance only moves once.
 *
 *   • REMOVAL — late return. Each appliance picked up after the agreement's end
 *     date (its last paid-for day) is charged for the late days, whatever the
 *     agreement's status says at that moment. The charges become one ordinary
 *     OPEN invoice with one "Late return – …" line per appliance plus the
 *     agreement's own sales tax, the same way the early-ending fee is billed.
 *     Nothing is charged to a card automatically.
 *
 *   • DELIVERY / INSTALLATION — late delivery. Staff can mark items "not
 *     delivered" on the visit that starts billing; each becomes a
 *     PendingDelivery. The whole agreement bills as normal. When a later
 *     delivery job brings the item, the customer gets an account credit for the
 *     days it was missing ("Credit – … delivered late – N days"); an item that
 *     never arrives and is taken off the agreement is credited everything
 *     billed for it. After the transaction commits the credit is sent to Stripe
 *     as customer-balance credit so it comes off the next monthly charge, and
 *     the next mirrored bill shows the same labeled line (webhooks.ts).
 *
 * Dates are the job's service date (`jobServiceDate`): the date staff recorded
 * the work as done, else the scheduled date — never the moment the status
 * button was pressed.
 */

export { NEVER_DELIVERED_UNASSIGN_REASON, LATE_DELIVERY_CREDIT_SOURCE };

/** The Colorado date a job's work happened: recorded by staff, else scheduled, else completed, else now. */
export function jobServiceDate(job: {
  performedOn: Date | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
}): Date {
  return job.performedOn ?? job.scheduledAt ?? job.completedAt ?? new Date();
}

/** Parse the "date the work was done" staff typed (YYYY-MM-DD) into the Colorado midnight it names. */
export function parsePerformedOn(raw: unknown, now: Date = new Date()): { ok: true; value: Date | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "Enter the date the work was done as a calendar date." };
  const date = businessDateFromKey(raw.trim());
  if (!date) return { ok: false, message: "Enter the date the work was done as a real calendar date." };
  // A date in the future would create late charges or credits for days that have not happened.
  if (businessDateKey(date) > businessDateKey(now)) {
    return { ok: false, message: "The date the work was done cannot be in the future." };
  }
  return { ok: true, value: date };
}

export type PickupBillingOutcome = {
  lateReturnInvoiceId: string | null;
  lateReturnCents: number;
  /** Credits created in this transaction; pushed to Stripe after commit. */
  creditIds: string[];
  creditCents: number;
  /** Items recorded as not delivered on this visit. */
  pendingDeliveryIds: string[];
  /** Plain-English notes for the audit trail (appliances skipped and why). */
  notes: string[];
};

const EMPTY: PickupBillingOutcome = {
  lateReturnInvoiceId: null,
  lateReturnCents: 0,
  creditIds: [],
  creditCents: 0,
  pendingDeliveryIds: [],
  notes: [],
};

async function loadSettings(tx: Prisma.TransactionClient): Promise<PickupBillingSettings> {
  const row = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: {
      lateReturnRateMode: true,
      lateReturnFixedDailyCents: true,
      lateDeliveryProrationBasis: true,
      pickupDayNotBilled: true,
    },
  });
  return pickupBillingSettingsFrom(row ?? {});
}

type Item = {
  assignmentId: string;
  applianceId: string;
  unassignedAt: Date | null;
  rentalLineId: string;
  label: string;
  monthlyPriceCents: number;
};

const SUPERSEDED_UNASSIGN_PREFIXES = [NEVER_DELIVERED_UNASSIGN_REASON, "Swapped out for repair", "Swapped for", "Replaced by"];

/** True when an ended assignment was replaced one-for-one (or never delivered), so it is not a priced item of its own. */
export function isSupersededAssignment(reason: string | null): boolean {
  return typeof reason === "string" && SUPERSEDED_UNASSIGN_PREFIXES.some((prefix) => reason.startsWith(prefix));
}

/** Which rental line each appliance is on, what it is called, and its share of the line price. */
async function itemsForAppliances(
  tx: Prisma.TransactionClient,
  agreementId: string,
  applianceIds: string[],
): Promise<Item[]> {
  if (applianceIds.length === 0) return [];
  const assignments = await tx.applianceAssignment.findMany({
    where: { applianceId: { in: applianceIds }, rentalLine: { agreementId } },
    orderBy: { assignedAt: "desc" },
    select: {
      id: true,
      applianceId: true,
      unassignedAt: true,
      rentalLine: {
        select: {
          id: true,
          monthlyPriceCents: true,
          assignments: { select: { applianceId: true, unassignReason: true }, orderBy: { assignedAt: "asc" } },
        },
      },
      appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
    },
  });
  // Newest assignment per appliance (an appliance can only be on one line at a time).
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const a of assignments) {
    if (seen.has(a.applianceId)) continue;
    seen.add(a.applianceId);
    // A unit that left the line without ever being a separate priced item (never delivered, or swapped
    // out and replaced one-for-one) must not shrink the others' share of the line price.
    const onLine = [
      ...new Set(
        a.rentalLine.assignments.filter((x) => !isSupersededAssignment(x.unassignReason)).map((x) => x.applianceId),
      ),
    ];
    const index = Math.max(0, onLine.indexOf(a.applianceId));
    items.push({
      assignmentId: a.id,
      applianceId: a.applianceId,
      unassignedAt: a.unassignedAt,
      rentalLineId: a.rentalLine.id,
      label: `${a.appliance.applianceType.name} #${a.appliance.assetNumber}`,
      monthlyPriceCents: itemMonthlyPriceCents(a.rentalLine.monthlyPriceCents, onLine.length, index),
    });
  }
  return items;
}

const AGREEMENT_SELECT = {
  id: true,
  customerId: true,
  status: true,
  endDate: true,
  billingStartedAt: true,
  paidInFullInAdvance: true,
  taxRateMilliPercent: true,
} as const;

/**
 * Rule 1. Called when a REMOVAL job completes, with the appliances it took
 * away. Any appliance picked up after the agreement's end date is charged for
 * the late days — even if the agreement is still marked ACTIVE at that moment.
 */
export async function recordLateReturnOnRemoval(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    applianceIds: string[];
    /** The job's service date (see `jobServiceDate`). */
    pickupDate: Date;
  },
): Promise<PickupBillingOutcome> {
  if (input.applianceIds.length === 0) return EMPTY;
  const agreement = await tx.rentalAgreement.findUnique({ where: { id: input.agreementId }, select: AGREEMENT_SELECT });
  if (!agreement) return EMPTY;
  if (!agreement.endDate) {
    return { ...EMPTY, notes: ["The agreement has no end date yet, so nothing was late."] };
  }
  const settings = await loadSettings(tx);
  const items = await itemsForAppliances(tx, agreement.id, input.applianceIds);
  if (items.length === 0) return { ...EMPTY, notes: ["None of the picked-up appliances were on this agreement."] };

  const charges = items
    .map((item) => ({
      item,
      charge: calculateLateReturnCharge({
        itemLabel: item.label,
        itemMonthlyPriceCents: item.monthlyPriceCents,
        agreedEndDate: agreement.endDate as Date,
        pickupDate: input.pickupDate,
        settings,
      }),
    }))
    .filter(({ charge }) => charge.days > 0 && charge.amountCents > 0);
  if (charges.length === 0) {
    return { ...EMPTY, notes: ["Picked up on time: no late-return days to charge."] };
  }

  await lockCustomerLedger(tx, agreement.customerId);
  const lines = charges.map(({ item, charge }) => ({
    kind: "LATE_RETURN" as const,
    description: charge.description,
    amountCents: charge.amountCents,
    quantity: 1,
    rentalLineId: item.rentalLineId,
  }));
  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const taxCents = sumTax(lines, agreement.taxRateMilliPercent);
  const invoice = await tx.invoice.create({
    data: {
      customerId: agreement.customerId,
      agreementId: agreement.id,
      status: "OPEN",
      billingPeriodStart: agreement.endDate,
      billingPeriodEnd: input.pickupDate,
      subtotalCents,
      taxCents,
      amountDueCents: subtotalCents + taxCents,
      amountPaidCents: 0,
      dueDate: input.pickupDate,
      lineItems: {
        createMany: {
          data: [
            ...lines,
            ...(taxCents > 0
              ? [{ kind: "TAX" as const, description: "Sales tax", amountCents: taxCents, quantity: 1, rentalLineId: null }]
              : []),
          ],
        },
      },
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: "billing.late_return_invoiced",
      entityType: "Invoice",
      entityId: invoice.id,
      newValue: {
        agreementId: agreement.id,
        agreementStatus: agreement.status,
        jobId: input.jobId,
        agreedEndDate: businessDateKey(agreement.endDate),
        pickupDate: businessDateKey(input.pickupDate),
        pickupDayNotBilled: settings.pickupDayNotBilled,
        items: charges.map(({ charge }) => ({
          description: charge.description,
          days: charge.days,
          dailyRate: formatCents(charge.dailyRateCents),
          amount: formatCents(charge.amountCents),
          basis: charge.basis,
          firstChargedDay: charge.firstChargedDayKey,
          lastChargedDay: charge.lastChargedDayKey,
        })),
        tax: formatCents(taxCents),
        total: formatCents(subtotalCents + taxCents),
      },
    },
  });
  return {
    ...EMPTY,
    lateReturnInvoiceId: invoice.id,
    lateReturnCents: subtotalCents + taxCents,
    notes: [`Late return billed: ${formatCents(subtotalCents + taxCents)} on one invoice.`],
  };
}

/**
 * Rule 2, first half. Called when a DELIVERY/INSTALLATION job completes, with
 * the appliances staff marked as NOT delivered on this visit. Each one is
 * recorded so it is never forgotten (Today → "Item not delivered yet") and so
 * its credit can be worked out when it arrives. The appliances stay reserved
 * for this customer; billing for the whole agreement starts as normal.
 */
export async function recordItemsNotDelivered(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    applianceIds: string[];
    /** The job's service date: the day billing starts counting these items. */
    deliveryDate: Date;
  },
): Promise<PickupBillingOutcome> {
  if (input.applianceIds.length === 0) return EMPTY;
  const items = await itemsForAppliances(tx, input.agreementId, input.applianceIds);
  const ids: string[] = [];
  const notes: string[] = [];
  for (const item of items) {
    const existing = await tx.pendingDelivery.findUnique({
      where: { originalJobId_applianceId: { originalJobId: input.jobId, applianceId: item.applianceId } },
      select: { id: true },
    });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const row = await tx.pendingDelivery.create({
      data: {
        agreementId: input.agreementId,
        rentalLineId: item.rentalLineId,
        applianceId: item.applianceId,
        originalJobId: input.jobId,
        originalDeliveryDate: input.deliveryDate,
        createdByUserId: input.userId,
      },
    });
    ids.push(row.id);
    notes.push(`${item.label}: not delivered on this visit; billed from ${formatBusinessDate(input.deliveryDate)}, credit due when it arrives.`);
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.item_not_delivered",
        entityType: "PendingDelivery",
        entityId: row.id,
        newValue: {
          agreementId: input.agreementId,
          jobId: input.jobId,
          applianceId: item.applianceId,
          item: item.label,
          originalDeliveryDate: businessDateKey(input.deliveryDate),
        },
      },
    });
  }
  return { ...EMPTY, pendingDeliveryIds: ids, notes };
}

/**
 * Rule 2, second half. Called when a DELIVERY/INSTALLATION job completes, with
 * the appliances it actually delivered. Any of them that was waiting from an
 * earlier visit is closed out and credited for the days it was missing.
 */
export async function recordLateDeliveries(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    applianceIds: string[];
    /** The job's service date: the day the item actually arrived. */
    deliveryDate: Date;
  },
): Promise<PickupBillingOutcome> {
  if (input.applianceIds.length === 0) return EMPTY;
  // A waiting item is closed out when it arrives itself, or when the same-type unit set aside to replace it does.
  const waiting = await tx.pendingDelivery.findMany({
    where: {
      agreementId: input.agreementId,
      deliveredOn: null,
      removedAt: null,
      OR: [{ applianceId: { in: input.applianceIds } }, { substituteApplianceId: { in: input.applianceIds } }],
    },
    select: { id: true, applianceId: true, substituteApplianceId: true, rentalLineId: true, originalDeliveryDate: true },
  });
  if (waiting.length === 0) return EMPTY;
  // Claim the waiting rows (sorted, so two jobs cannot deadlock) and re-read them: a second job that delivers the
  // same item at the same time waits here, then finds it already delivered and issues no second credit.
  const waitingIds = waiting.map((w) => w.id).sort();
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "PendingDelivery" WHERE "id" = ANY(${waitingIds}) AND "deliveredOn" IS NULL AND "removedAt" IS NULL
    ORDER BY "id" FOR UPDATE
  `;
  const stillWaiting = new Set(lockedRows.map((r) => r.id));
  for (let i = waiting.length - 1; i >= 0; i--) if (!stillWaiting.has(waiting[i].id)) waiting.splice(i, 1);
  if (waiting.length === 0) return EMPTY;

  const agreement = await tx.rentalAgreement.findUnique({ where: { id: input.agreementId }, select: AGREEMENT_SELECT });
  if (!agreement) return EMPTY;
  const settings = await loadSettings(tx);
  // The unit that actually arrived: the substitute when it was the one delivered, otherwise the waiting item itself.
  const arrivedId = (w: { applianceId: string; substituteApplianceId: string | null }) =>
    w.substituteApplianceId && input.applianceIds.includes(w.substituteApplianceId) ? w.substituteApplianceId : w.applianceId;
  const items = await itemsForAppliances(tx, agreement.id, waiting.map(arrivedId));
  const creditIds: string[] = [];
  let creditCents = 0;
  const notes: string[] = [];

  for (const pending of waiting) {
    const item = items.find((i) => i.applianceId === arrivedId(pending));
    await tx.pendingDelivery.update({
      where: { id: pending.id },
      data: { deliveredOn: input.deliveryDate, deliveredJobId: input.jobId },
    });
    if (!item) {
      notes.push("A waiting item is no longer on this agreement; delivered without a credit.");
      continue;
    }
    if (!agreement.billingStartedAt) {
      notes.push(`${item.label}: delivered; no credit because billing never started for this agreement.`);
      continue;
    }
    if (agreement.paidInFullInAdvance) {
      notes.push(`${item.label}: delivered; no automatic credit, this rental was paid in full in advance (owner decides).`);
      continue;
    }
    const dayBefore = new Date(input.deliveryDate.getTime() - 1000);
    // Stripe bills from the real first-delivery day (IN-28), so billingStartedAt is the billing start. An older
    // agreement whose subscription was created before that rule can have started later than a back-dated
    // delivery date; days before billingStartedAt were never billed, so they are never credited.
    const billedFrom = businessDaysBetween(pending.originalDeliveryDate, agreement.billingStartedAt) > 0
      ? businessDayBounds(agreement.billingStartedAt).start
      : pending.originalDeliveryDate;
    const credit = calculateLateDeliveryCredit({
      itemLabel: item.label,
      itemMonthlyPriceCents: item.monthlyPriceCents,
      originalDeliveryDate: billedFrom,
      actualDeliveryDate: input.deliveryDate,
      period: billingPeriodContaining(agreement.billingStartedAt, billedFrom),
      billingAnchor: agreement.billingStartedAt,
      maxCreditCents: item.monthlyPriceCents * periodsBilledThrough(agreement.billingStartedAt, dayBefore),
      settings,
    });
    if (credit.days === 0 || credit.amountCents === 0) {
      notes.push(`${item.label}: delivered on the original date after all, nothing to credit.`);
      continue;
    }
    const row = await tx.customerCredit.create({
      data: {
        customerId: agreement.customerId,
        amountCents: credit.amountCents,
        remainingCents: credit.amountCents,
        reason: credit.description,
        notes: `${credit.basis}; missing ${formatBusinessDate(pending.originalDeliveryDate)} through the day before ${formatBusinessDate(input.deliveryDate)}.`,
        authorizedByUserId: input.userId,
        sourceType: LATE_DELIVERY_CREDIT_SOURCE,
        sourceId: pending.id,
        side: "CUSTOMER",
      },
    });
    await tx.pendingDelivery.update({ where: { id: pending.id }, data: { creditId: row.id } });
    creditIds.push(row.id);
    creditCents += credit.amountCents;
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.late_delivery_credit",
        entityType: "CustomerCredit",
        entityId: row.id,
        newValue: {
          agreementId: agreement.id,
          jobId: input.jobId,
          pendingDeliveryId: pending.id,
          applianceId: item.applianceId,
          description: credit.description,
          days: credit.days,
          periodDays: credit.periodDays,
          originalDeliveryDate: businessDateKey(pending.originalDeliveryDate),
          actualDeliveryDate: businessDateKey(input.deliveryDate),
          dailyRate: formatCents(credit.dailyRateCents),
          amount: formatCents(credit.amountCents),
          basis: credit.basis,
          firstCreditedDay: credit.firstCreditedDayKey,
          lastCreditedDay: credit.lastCreditedDayKey,
          nextStep: "Sent to Stripe as account-balance credit; it comes off the next monthly charge and shows on that bill as its own line.",
        },
      },
    });
    notes.push(`${item.label}: delivered ${credit.days} days late, credit ${formatCents(credit.amountCents)}.`);
  }
  return { ...EMPTY, creditIds, creditCents, notes };
}

/**
 * Rule 2, never delivered. The owner or an admin takes a waiting item off the agreement: the appliance is released
 * (available again), any substitute unit set aside for it goes back on the shelf, and the customer is REFUNDED what
 * was paid for it (one month's price plus its tax for every billing period that has started since the original
 * delivery date, never more than was actually paid). Stripe-paid money goes back to the original card or bank;
 * money paid another way is recorded for the owner to pay back by hand. No account credit is created.
 *
 * Batch C section 8 also fixes the monthly bill: the item's share comes off its rental line from the NEXT billing
 * period (kept as a never-edited amendment record), and the Stripe subscription is told after the transaction
 * commits (one recorded provider operation, retried by the reconciliation pass). If that was the agreement's last
 * item, the agreement is ended or cancelled through the normal close path instead.
 *
 * Lock order (spec §0): customer, agreement, appliances (sorted), the waiting row.
 */
export async function removeUndeliveredItem(userId: string, pendingDeliveryId: string, now = new Date()): Promise<void> {
  const peek = await prisma.pendingDelivery.findUnique({
    where: { id: pendingDeliveryId },
    select: { agreementId: true, applianceId: true, agreement: { select: { customerId: true } } },
  });
  if (!peek) throw new Error("Couldn't find that waiting item.");

  const outcome = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockCustomerLedger(tx, peek.agreement.customerId);
    await lockRentalAgreementInTx(tx, peek.agreementId);
    const first = await tx.pendingDelivery.findUnique({
      where: { id: pendingDeliveryId },
      select: { applianceId: true, substituteApplianceId: true },
    });
    if (!first) throw new Error("Couldn't find that waiting item.");
    const applianceIds = [...new Set([first.applianceId, first.substituteApplianceId].filter((id): id is string => Boolean(id)))].sort();
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${applianceIds}) ORDER BY "id" FOR UPDATE`;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PendingDelivery" WHERE "id" = ${pendingDeliveryId} FOR UPDATE
    `;
    if (!locked[0]) throw new Error("Couldn't find that waiting item.");
    const pending = await tx.pendingDelivery.findUniqueOrThrow({ where: { id: pendingDeliveryId } });
    if (pending.deliveredOn || pending.removedAt) {
      throw new Error("That item was already delivered or already taken off the agreement.");
    }
    if (pending.substituteApplianceId !== first.substituteApplianceId) {
      throw new Error("A substitute was just set or removed for this item. Reload and try again.");
    }
    const agreement = await tx.rentalAgreement.findUniqueOrThrow({ where: { id: pending.agreementId }, select: AGREEMENT_SELECT });

    // A substitute set aside for this item goes back on the shelf, and its place on the visit's list is dropped.
    if (pending.substituteApplianceId && pending.substituteJobId) {
      await dropSubstituteInTx(tx, {
        userId,
        jobId: pending.substituteJobId,
        substituteApplianceId: pending.substituteApplianceId,
      });
      await tx.jobAppliance.deleteMany({
        where: { jobId: pending.substituteJobId, applianceId: pending.substituteApplianceId, role: "REPLACEMENT", result: null },
      });
    }

    // The share is worked out BEFORE the unit leaves the line, while it still counts as one of the line's items.
    const [item] = await itemsForAppliances(tx, agreement.id, [pending.applianceId]);

    if (item && !item.unassignedAt) {
      await tx.applianceAssignment.update({
        where: { id: item.assignmentId },
        data: { unassignedAt: now, unassignReason: NEVER_DELIVERED_UNASSIGN_REASON },
      });
    }
    await tx.appliance.updateMany({ where: { id: pending.applianceId, status: "RESERVED" }, data: { status: "AVAILABLE" } });

    // Money for an item that never arrives goes BACK to the customer (a refund), not into account credit that would
    // keep reducing future bills. Stripe-paid invoices are refunded to the original card or bank through Stripe;
    // anything paid another way, paid in advance, or not paid yet is recorded for the owner to settle by hand.
    let refundedCents = 0;
    let refundByHandCents = 0;
    const refundRuns: Array<{ refundId: string; claim: ClaimedRefund; invoiceId: string; amountCents: number }> = [];
    const refundIds: string[] = [];
    let note = "";
    if (!item) {
      note = "The item was no longer on the agreement; nothing to refund.";
    } else if (!agreement.billingStartedAt) {
      note = `${item.label}: billing never started, nothing to refund.`;
    } else if (agreement.paidInFullInAdvance) {
      note = `${item.label}: paid in full in advance, the owner settles the refund by hand.`;
    } else {
      const periods = periodsBilledThrough(agreement.billingStartedAt, now);
      const owedCents = (item.monthlyPriceCents + taxCentsForLine(item.monthlyPriceCents, agreement.taxRateMilliPercent)) * periods;
      let remaining = owedCents;
      const invoices = remaining > 0
        ? await tx.invoice.findMany({
            where: { agreementId: agreement.id, amountPaidCents: { gt: 0 }, status: { notIn: ["VOID", "DRAFT"] } },
            orderBy: [{ billingPeriodStart: "desc" }, { createdAt: "desc" }],
            select: { id: true, amountPaidCents: true, refunds: { select: { amountCents: true } } },
          })
        : [];
      for (const invoice of invoices) {
        if (remaining <= 0) break;
        const refundable = invoice.amountPaidCents - invoice.refunds.reduce((sum, r) => sum + r.amountCents, 0);
        const chunk = Math.min(remaining, refundable);
        if (chunk <= 0) continue;
        const prepared = await prepareInvoiceRefundInTx(tx, userId, {
          invoiceId: invoice.id,
          amountCents: chunk,
          reason: "BILLING_ERROR",
          notes: `Never delivered: ${item.label} taken off the agreement.`,
        });
        refundIds.push(prepared.refundId);
        if (prepared.claim) {
          refundRuns.push({ refundId: prepared.refundId, claim: prepared.claim, invoiceId: invoice.id, amountCents: chunk });
          refundedCents += chunk;
        } else {
          refundByHandCents += chunk;
        }
        remaining -= chunk;
      }
      if (owedCents === 0) {
        note = `${item.label}: taken off the agreement before anything was billed for it.`;
      } else {
        note = `${item.label}: taken off the agreement. Billed for ${periods} month(s), ${formatCents(owedCents)} with tax.`;
        if (refundedCents > 0) note += ` ${formatCents(refundedCents)} is being refunded to the card or bank it was paid with.`;
        if (refundByHandCents > 0) note += ` ${formatCents(refundByHandCents)} was paid another way, so you pay that back by hand.`;
        if (remaining > 0) note += ` ${formatCents(remaining)} was billed but never paid, so there is nothing to refund for it.`;
      }
    }
    const creditId: string | null = null;
    await tx.pendingDelivery.update({ where: { id: pending.id }, data: { removedAt: now, creditId, refundedCents, refundByHandCents } });

    // What the monthly bill does about it.
    let amendmentId: string | null = null;
    let lineClaim: LineReduceClaim | null = null;
    let closed: CloseAgreementResult | null = null;
    const openLeft = await tx.applianceAssignment.count({
      where: { unassignedAt: null, rentalLine: { agreementId: agreement.id } },
    });
    if (agreement.status === "ACTIVE" && openLeft === 0) {
      // Nothing left on the agreement: end it the normal way (which cancels the whole subscription).
      const everDelivered = await tx.applianceAssignment.count({
        where: {
          rentalLine: { agreementId: agreement.id },
          NOT: [{ unassignReason: { startsWith: NEVER_DELIVERED_UNASSIGN_REASON } }, { unassignReason: { startsWith: "Replaced by" } }],
        },
      });
      closed = await closeAgreementInTx(tx, userId, agreement.id, everDelivered > 0 ? "ENDED" : "CANCELLED", { endedOn: now });
      note += " That was the last item, so the agreement was closed.";
    } else if (item && !agreement.paidInFullInAdvance) {
      const line = await tx.rentalLine.findUniqueOrThrow({ where: { id: item.rentalLineId }, select: { id: true, monthlyPriceCents: true } });
      const newPrice = Math.max(0, line.monthlyPriceCents - item.monthlyPriceCents);
      const effectiveFrom = agreement.billingStartedAt ? billingPeriodContaining(agreement.billingStartedAt, now).end : now;
      const amendment = await tx.rentalLineAmendment.create({
        data: {
          rentalLineId: line.id,
          pendingDeliveryId: pending.id,
          previousMonthlyPriceCents: line.monthlyPriceCents,
          newMonthlyPriceCents: newPrice,
          effectiveFrom,
          reason: `${item.label} was never delivered and was taken off the agreement.`,
          createdByUserId: userId,
        },
      });
      amendmentId = amendment.id;
      await tx.rentalLine.update({ where: { id: line.id }, data: { monthlyPriceCents: newPrice } });
      const withSubscription = await tx.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id }, select: { stripeSubscriptionId: true } });
      if (withSubscription.stripeSubscriptionId) {
        lineClaim = await claimLineReductionInTx(tx, { pendingDeliveryId: pending.id, rentalLineId: line.id });
      }
      note += ` Monthly price of its line goes from ${formatCents(line.monthlyPriceCents)} to ${formatCents(newPrice)} starting ${formatBusinessDate(effectiveFrom)}.`;
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: "billing.item_never_delivered",
        entityType: "PendingDelivery",
        entityId: pending.id,
        newValue: {
          agreementId: agreement.id,
          applianceId: pending.applianceId,
          refundIds,
          refundedCents,
          refundByHandCents,
          amendmentId,
          lineReductionOperationId: lineClaim && !lineClaim.done ? lineClaim.opId : null,
          agreementClosed: closed ? closed.updated.status : null,
          note,
        },
      },
    });
    if (amendmentId) {
      await tx.auditLog.create({
        data: { userId, action: "agreement.item_cancelled", entityType: "RentalAgreement", entityId: agreement.id, newValue: { pendingDeliveryId: pending.id, amendmentId } },
      });
    }
    return { refundRuns, lineClaim, closed, pendingId: pending.id };
  });

  if (outcome.closed) {
    try {
      await runCloseAgreementContinuation(outcome.closed);
    } catch (error) {
      console.error(`Closed agreement after the last item was cancelled but could not finish the Stripe side yet:`, error);
    }
  } else if (outcome.lineClaim) {
    try {
      await runLineReduction(outcome.pendingId, outcome.lineClaim);
    } catch (error) {
      console.error(`Could not lower the subscription line for waiting item ${outcome.pendingId} yet:`, error);
    }
  }
  for (const run of outcome.refundRuns) {
    try {
      await runPreparedInvoiceRefund(run);
    } catch (error) {
      console.error(`Could not send never-delivered refund ${run.refundId} to Stripe yet:`, error);
    }
  }
}

/** Items of an agreement still waiting for delivery (for Today and the job page). */
export async function pendingDeliveriesForJob(jobId: string) {
  const rows = await prisma.pendingDelivery.findMany({
    where: { originalJobId: jobId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      agreementId: true,
      originalDeliveryDate: true,
      deliveredOn: true,
      removedAt: true,
      creditId: true,
      refundedCents: true,
      refundByHandCents: true,
      substituteJobId: true,
      substituteAppliance: { select: { assetNumber: true } },
      appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
    },
  });
  // A cancelled item's change to the monthly subscription is shown as pending until Stripe has the new amount.
  const removedIds = rows.filter((row) => row.removedAt).map((row) => row.id);
  const operations = removedIds.length
    ? await prisma.providerOperation.findMany({
        where: { idempotencyKey: { in: removedIds.map(lineReduceKey) } },
        select: { idempotencyKey: true, status: true },
      })
    : [];
  const statusByKey = new Map(operations.map((op) => [op.idempotencyKey, op.status]));
  return rows.map((row) => ({
    ...row,
    // true while a recorded Stripe update for this item has not finished
    stripeUpdatePending: row.removedAt ? (statusByKey.has(lineReduceKey(row.id)) && statusByKey.get(lineReduceKey(row.id)) !== "SUCCEEDED") : false,
  }));
}

/**
 * Send one late-delivery credit to Stripe as customer-balance credit (the same
 * durable provider operation referral rewards use; src/domains/billing/
 * reconciliation.ts retries it if this attempt does not finish). Runs AFTER
 * the transaction that created the credit committed, never inside it.
 */
export async function pushLateDeliveryCreditToStripe(creditId: string): Promise<void> {
  const latest = await prisma.customerCredit.findUnique({
    where: { id: creditId },
    include: { customer: { select: { stripeCustomerId: true } } },
  });
  if (!latest || latest.appliedViaStripeAt || !latest.customer.stripeCustomerId) return;

  let claim:
    | { kind: "done" }
    | { kind: "local" }
    | { kind: "claimed"; opId: string; idempotencyKey: string };
  try {
    claim = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; amountCents: number; remainingCents: number; appliedViaStripeAt: Date | null }>
      >`
        SELECT "id", "amountCents", "remainingCents", "appliedViaStripeAt"
        FROM "CustomerCredit"
        WHERE "id" = ${creditId}
        FOR UPDATE
      `;
      const credit = locked[0];
      if (!credit || credit.appliedViaStripeAt) return { kind: "done" as const };
      // Spent locally already (the owner applied it by hand): never also send it to Stripe.
      if (credit.remainingCents < credit.amountCents) return { kind: "local" as const };
      const providerClaim = await claimProviderOperation(tx, {
        kind: "BALANCE_CREDIT",
        subjectType: "CustomerCredit",
        subjectId: creditId,
        idempotencyKey: `late-delivery-credit-${creditId}`,
      });
      return providerClaim.done
        ? { kind: "done" as const }
        : { kind: "claimed" as const, opId: providerClaim.opId, idempotencyKey: providerClaim.idempotencyKey };
    });
  } catch (error) {
    if (error instanceof RetryLater) return;
    throw error;
  }
  if (claim.kind !== "claimed") return;

  const stripe = getStripeClient();
  const result = await runProviderCall(() =>
    stripe.customers.createBalanceTransaction(
      latest.customer.stripeCustomerId!,
      {
        amount: -latest.amountCents,
        currency: "usd",
        description: latest.reason,
        metadata: { creditId, sourceType: LATE_DELIVERY_CREDIT_SOURCE, sourceId: latest.sourceId ?? "" },
      },
      { idempotencyKey: claim.idempotencyKey },
    ),
  );

  const opId = claim.opId;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CustomerCredit" WHERE "id" = ${creditId} FOR UPDATE`;
    if (result.ok) {
      await tx.customerCredit.update({
        where: { id: creditId },
        data: {
          appliedViaStripeAt: new Date(),
          remainingCents: 0,
          notes: `${latest.notes ?? ""} Sent to Stripe as account-balance credit ${result.value.id}; it comes off the next monthly charge.`.trim(),
        },
      });
      await completeProviderOperation(tx, opId, { status: "SUCCEEDED", providerObjectId: result.value.id });
      return;
    }
    await completeProviderOperation(tx, opId, { status: result.outcome, error: result.error });
  });
}

/** Whole Colorado days between two instants, exposed for the job page's "waiting since" text. */
export const daysWaiting = (since: Date, now = new Date()) => Math.max(0, businessDaysBetween(since, now));
