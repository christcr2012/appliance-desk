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
 *     delivered" on a visit; each becomes a PendingDelivery. Billing begins only
 *     when at least one rental item is actually delivered. On a partial delivery,
 *     the whole agreement is billed from that first real delivery date and each
 *     missing item is credited for the days it was unavailable. A zero-delivery
 *     visit records the waiting items but starts no billing. When a later visit
 *     brings an item, the customer gets an account credit for the chargeable
 *     missing days ("Credit – … delivered late – N days"). After commit the
 *     credit is sent to Stripe as customer-balance credit so it comes off a
 *     monthly charge and the mirrored bill shows the same labeled line.
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
  if (businessDateKey(date) > businessDateKey(now)) {
    return { ok: false, message: "The date the work was done cannot be in the future." };
  }
  return { ok: true, value: date };
}

export type PickupBillingOutcome = {
  lateReturnInvoiceId: string | null;
  lateReturnCents: number;
  creditIds: string[];
  creditCents: number;
  pendingDeliveryIds: string[];
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

export function isSupersededAssignment(reason: string | null): boolean {
  return typeof reason === "string" && SUPERSEDED_UNASSIGN_PREFIXES.some((prefix) => reason.startsWith(prefix));
}

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
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const a of assignments) {
    if (seen.has(a.applianceId)) continue;
    seen.add(a.applianceId);
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
  firstDeliveredOn: true,
  billingStartedAt: true,
  paidInFullInAdvance: true,
  taxRateMilliPercent: true,
} as const;

export async function recordLateReturnOnRemoval(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    applianceIds: string[];
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

/** Record the items that did not arrive. A zero-delivery visit records waiting work but starts no billing. */
export async function recordItemsNotDelivered(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    applianceIds: string[];
    deliveryDate: Date;
  },
): Promise<PickupBillingOutcome> {
  if (input.applianceIds.length === 0) return EMPTY;
  const [items, anchorRow] = await Promise.all([
    itemsForAppliances(tx, input.agreementId, input.applianceIds),
    tx.rentalAgreement.findUnique({ where: { id: input.agreementId }, select: { firstDeliveredOn: true } }),
  ]);
  const billingAnchor = anchorRow?.firstDeliveredOn ?? null;
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
    notes.push(
      billingAnchor
        ? `${item.label}: not delivered on this visit; billing is anchored to ${formatBusinessDate(billingAnchor)}, credit due when it arrives.`
        : `${item.label}: not delivered on this visit; billing has not started because no rental item was delivered.`,
    );
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
          billingAnchor: billingAnchor ? businessDateKey(billingAnchor) : null,
        },
      },
    });
  }
  return { ...EMPTY, pendingDeliveryIds: ids, notes };
}

/** Close waiting items that arrive and create the credit implied by the durable first-delivery billing anchor. */
export async function recordLateDeliveries(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    applianceIds: string[];
    deliveryDate: Date;
  },
): Promise<PickupBillingOutcome> {
  if (input.applianceIds.length === 0) return EMPTY;
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
  const arrivedId = (w: { applianceId: string; substituteApplianceId: string | null }) =>
    w.substituteApplianceId && input.applianceIds.includes(w.substituteApplianceId) ? w.substituteApplianceId : w.applianceId;
  const items = await itemsForAppliances(tx, agreement.id, waiting.map(arrivedId));
  const creditIds: string[] = [];
  let creditCents = 0;
  const notes: string[] = [];
  const billingAnchor = agreement.billingStartedAt ?? agreement.firstDeliveredOn;

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
    if (!billingAnchor) {
      notes.push(`${item.label}: delivered; no credit because no real delivery ever started billing for this agreement.`);
      continue;
    }
    if (agreement.paidInFullInAdvance) {
      notes.push(`${item.label}: delivered; no automatic credit, this rental was paid in full in advance (owner decides).`);
      continue;
    }
    const dayBefore = new Date(input.deliveryDate.getTime() - 1000);
    const billedFrom = businessDaysBetween(pending.originalDeliveryDate, billingAnchor) > 0
      ? businessDayBounds(billingAnchor).start
      : pending.originalDeliveryDate;
    const credit = calculateLateDeliveryCredit({
      itemLabel: item.label,
      itemMonthlyPriceCents: item.monthlyPriceCents,
      originalDeliveryDate: billedFrom,
      actualDeliveryDate: input.deliveryDate,
      period: billingPeriodContaining(billingAnchor, billedFrom),
      billingAnchor,
      maxCreditCents: item.monthlyPriceCents * periodsBilledThrough(billingAnchor, dayBefore),
      settings,
    });
    if (credit.days === 0 || credit.amountCents === 0) {
      notes.push(`${item.label}: delivered on the billing anchor after all, nothing to credit.`);
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
          billingAnchor: businessDateKey(billingAnchor),
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

    const [item] = await itemsForAppliances(tx, agreement.id, [pending.applianceId]);

    if (item && !item.unassignedAt) {
      await tx.applianceAssignment.update({
        where: { id: item.assignmentId },
        data: { unassignedAt: now, unassignReason: NEVER_DELIVERED_UNASSIGN_REASON },
      });
    }
    await tx.appliance.updateMany({ where: { id: pending.applianceId, status: "RESERVED" }, data: { status: "AVAILABLE" } });

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

    let amendmentId: string | null = null;
    let lineClaim: LineReduceClaim | null = null;
    let closed: CloseAgreementResult | null = null;
    const openLeft = await tx.applianceAssignment.count({
      where: { unassignedAt: null, rentalLine: { agreementId: agreement.id } },
    });
    if (agreement.status === "ACTIVE" && openLeft === 0) {
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
    stripeUpdatePending: row.removedAt ? (statusByKey.has(lineReduceKey(row.id)) && statusByKey.get(lineReduceKey(row.id)) !== "SUCCEEDED") : false,
  }));
}

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

export const daysWaiting = (since: Date, now = new Date()) => Math.max(0, businessDaysBetween(since, now));
