import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateFromKey, businessDateKey, businessDaysBetween, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { sumTax } from "./tax";
import { lockCustomerLedger } from "./ledger";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { claimProviderOperation, completeProviderOperation, RetryLater, runProviderCall } from "./provider-ops";
import {
  LATE_DELIVERY_CREDIT_SOURCE,
  NEVER_DELIVERED_UNASSIGN_REASON,
  billingPeriodContaining,
  calculateLateDeliveryCredit,
  calculateLateReturnCharge,
  calculateNeverDeliveredCredit,
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
export function parsePerformedOn(raw: unknown): { ok: true; value: Date | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "Enter the date the work was done as a calendar date." };
  const date = businessDateFromKey(raw.trim());
  if (!date) return { ok: false, message: "Enter the date the work was done as a real calendar date." };
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
          assignments: { select: { applianceId: true }, orderBy: { assignedAt: "asc" } },
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
    const onLine = [...new Set(a.rentalLine.assignments.map((x) => x.applianceId))];
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
  const waiting = await tx.pendingDelivery.findMany({
    where: { agreementId: input.agreementId, applianceId: { in: input.applianceIds }, deliveredOn: null, removedAt: null },
    select: { id: true, applianceId: true, rentalLineId: true, originalDeliveryDate: true },
  });
  if (waiting.length === 0) return EMPTY;

  const agreement = await tx.rentalAgreement.findUnique({ where: { id: input.agreementId }, select: AGREEMENT_SELECT });
  if (!agreement) return EMPTY;
  const settings = await loadSettings(tx);
  const items = await itemsForAppliances(tx, agreement.id, waiting.map((w) => w.applianceId));
  const creditIds: string[] = [];
  let creditCents = 0;
  const notes: string[] = [];

  for (const pending of waiting) {
    const item = items.find((i) => i.applianceId === pending.applianceId);
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
    const credit = calculateLateDeliveryCredit({
      itemLabel: item.label,
      itemMonthlyPriceCents: item.monthlyPriceCents,
      originalDeliveryDate: pending.originalDeliveryDate,
      actualDeliveryDate: input.deliveryDate,
      period: billingPeriodContaining(agreement.billingStartedAt, pending.originalDeliveryDate),
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
 * Rule 2, never delivered. The owner or an admin takes a waiting item off the
 * agreement: the appliance is released (available again), and the customer is
 * credited one month's price for every billing period that has started since
 * the original delivery date. The credit is then sent to Stripe.
 */
export async function removeUndeliveredItem(userId: string, pendingDeliveryId: string, now = new Date()): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PendingDelivery" WHERE "id" = ${pendingDeliveryId} FOR UPDATE
    `;
    if (!locked[0]) throw new Error("Couldn't find that waiting item.");
    const pending = await tx.pendingDelivery.findUniqueOrThrow({ where: { id: pendingDeliveryId } });
    if (pending.deliveredOn || pending.removedAt) {
      throw new Error("That item was already delivered or already taken off the agreement.");
    }
    const agreement = await tx.rentalAgreement.findUniqueOrThrow({ where: { id: pending.agreementId }, select: AGREEMENT_SELECT });
    const [item] = await itemsForAppliances(tx, agreement.id, [pending.applianceId]);

    if (item && !item.unassignedAt) {
      await tx.applianceAssignment.update({
        where: { id: item.assignmentId },
        data: { unassignedAt: now, unassignReason: NEVER_DELIVERED_UNASSIGN_REASON },
      });
    }
    await tx.appliance.updateMany({ where: { id: pending.applianceId, status: "RESERVED" }, data: { status: "AVAILABLE" } });

    let creditId: string | null = null;
    let note = "";
    if (!item) {
      note = "The item was no longer on the agreement; nothing to credit.";
    } else if (!agreement.billingStartedAt) {
      note = `${item.label}: billing never started, nothing to credit.`;
    } else if (agreement.paidInFullInAdvance) {
      note = `${item.label}: paid in full in advance, the owner settles the credit by hand.`;
    } else {
      const credit = calculateNeverDeliveredCredit({
        itemLabel: item.label,
        itemMonthlyPriceCents: item.monthlyPriceCents,
        periodsBilled: periodsBilledThrough(agreement.billingStartedAt, now),
      });
      if (credit.amountCents > 0) {
        const row = await tx.customerCredit.create({
          data: {
            customerId: agreement.customerId,
            amountCents: credit.amountCents,
            remainingCents: credit.amountCents,
            reason: credit.description,
            notes: `Never delivered; everything billed for it since ${formatBusinessDate(pending.originalDeliveryDate)} is credited.`,
            authorizedByUserId: userId,
            sourceType: LATE_DELIVERY_CREDIT_SOURCE,
            sourceId: pending.id,
            side: "CUSTOMER",
          },
        });
        creditId = row.id;
        note = `${item.label}: taken off the agreement, credit ${formatCents(credit.amountCents)} for ${credit.months} billed month(s).`;
      } else {
        note = `${item.label}: taken off the agreement before anything was billed for it.`;
      }
    }
    await tx.pendingDelivery.update({ where: { id: pending.id }, data: { removedAt: now, creditId } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "billing.item_never_delivered",
        entityType: "PendingDelivery",
        entityId: pending.id,
        newValue: {
          agreementId: agreement.id,
          applianceId: pending.applianceId,
          creditId,
          note,
          followUp:
            "The item's rental line is still on the monthly subscription: adjust the subscription in Stripe or end and re-sign the agreement.",
        },
      },
    });
    return { creditId };
  });
  if (outcome.creditId) {
    try {
      await pushLateDeliveryCreditToStripe(outcome.creditId);
    } catch (error) {
      console.error(`Could not send never-delivered credit ${outcome.creditId} to Stripe yet:`, error);
    }
  }
}

/** Items of an agreement still waiting for delivery (for Today and the job page). */
export async function pendingDeliveriesForJob(jobId: string) {
  return prisma.pendingDelivery.findMany({
    where: { originalJobId: jobId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      originalDeliveryDate: true,
      deliveredOn: true,
      removedAt: true,
      appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } },
    },
  });
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
