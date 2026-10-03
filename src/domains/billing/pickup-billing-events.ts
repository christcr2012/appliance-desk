import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { sumTax } from "./tax";
import { lockCustomerLedger } from "./ledger";
import { claimProviderOperation, completeProviderOperation, RetryLater, runProviderCall } from "./provider-ops";
import {
  EARLY_RETURN_CREDIT_SOURCE,
  EARLY_RETURN_UNASSIGN_REASON,
  billingPeriodContaining,
  calculateEarlyReturnCredit,
  calculateLateReturnCharge,
  itemMonthlyPriceCents,
  pickupBillingSettingsFrom,
  type PickupBillingSettings,
} from "./pickup-billing";

/**
 * What a completed REMOVAL job does to billing (owner decisions IN-24 / IN-26 /
 * IN-27, 2026-10-03). Called inside the job-completion transaction with the
 * appliances that job actually took away, so it runs exactly once per
 * appliance: a job completes once, and an appliance only moves once.
 *
 *   • Agreement already ENDED (its end date is the last paid-for day): each
 *     appliance picked up after that date is charged for the late days. The
 *     charges become one ordinary OPEN invoice with one "Late return – …" line
 *     per appliance (plus the agreement's own sales tax), the same way the
 *     early-ending fee is billed. The customer pays it like any other invoice
 *     and the owner can see, adjust or write it off; nothing is charged to a
 *     card automatically.
 *
 *   • Agreement still ACTIVE (a partial pickup — the rest carries on): each
 *     appliance is released from the agreement and earns an account credit for
 *     the days of the already-billed period it was not in the customer's hands,
 *     labeled "Credit – … returned early – N days". After the transaction
 *     commits, the credit is sent to Stripe as customer-balance credit so it
 *     comes off the customer's next monthly charge; the next bill then shows
 *     the same labeled line (src/domains/billing/webhooks.ts).
 *
 * Lost, stolen or damaged appliances never come through here with a credit:
 * only an appliance a completed pickup job physically took away is eligible.
 */

export { EARLY_RETURN_UNASSIGN_REASON, EARLY_RETURN_CREDIT_SOURCE };

export type PickupBillingOutcome = {
  lateReturnInvoiceId: string | null;
  lateReturnCents: number;
  /** Credits created in this transaction; pushed to Stripe after commit. */
  earlyReturnCreditIds: string[];
  earlyReturnCents: number;
  /** Plain-English notes for the audit trail (appliances skipped and why). */
  notes: string[];
};

const EMPTY: PickupBillingOutcome = {
  lateReturnInvoiceId: null,
  lateReturnCents: 0,
  earlyReturnCreditIds: [],
  earlyReturnCents: 0,
  notes: [],
};

async function loadSettings(tx: Prisma.TransactionClient): Promise<PickupBillingSettings> {
  const row = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: {
      lateReturnRateMode: true,
      lateReturnFixedDailyCents: true,
      earlyReturnProrationBasis: true,
      pickupDayNotBilled: true,
    },
  });
  return pickupBillingSettingsFrom(row ?? {});
}

/** Which rental line each picked-up appliance was on, and what it is called. */
async function itemsForAppliances(
  tx: Prisma.TransactionClient,
  agreementId: string,
  applianceIds: string[],
) {
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
  const items: Array<{
    assignmentId: string;
    applianceId: string;
    unassignedAt: Date | null;
    rentalLineId: string;
    label: string;
    monthlyPriceCents: number;
  }> = [];
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

export async function recordPickupBillingOnRemoval(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    agreementId: string;
    /** Appliances this job actually took away (already moved by the caller). */
    applianceIds: string[];
    completedAt: Date;
  },
): Promise<PickupBillingOutcome> {
  if (input.applianceIds.length === 0) return EMPTY;

  const agreement = await tx.rentalAgreement.findUnique({
    where: { id: input.agreementId },
    select: {
      id: true,
      customerId: true,
      status: true,
      endDate: true,
      billingStartedAt: true,
      paidInFullInAdvance: true,
      taxRateMilliPercent: true,
    },
  });
  if (!agreement) return EMPTY;
  if (agreement.status !== "ENDED" && agreement.status !== "ACTIVE") {
    return { ...EMPTY, notes: [`Agreement is ${agreement.status.toLowerCase()}: no pickup billing applies.`] };
  }

  const settings = await loadSettings(tx);
  const items = await itemsForAppliances(tx, agreement.id, input.applianceIds);
  if (items.length === 0) return { ...EMPTY, notes: ["None of the picked-up appliances were on this agreement."] };

  if (agreement.status === "ENDED") {
    if (!agreement.endDate) {
      return { ...EMPTY, notes: ["The agreement has no end date, so late days could not be counted."] };
    }
    const charges = items
      .map((item) => ({
        item,
        charge: calculateLateReturnCharge({
          itemLabel: item.label,
          itemMonthlyPriceCents: item.monthlyPriceCents,
          agreedEndDate: agreement.endDate as Date,
          pickupDate: input.completedAt,
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
        billingPeriodEnd: input.completedAt,
        subtotalCents,
        taxCents,
        amountDueCents: subtotalCents + taxCents,
        amountPaidCents: 0,
        dueDate: input.completedAt,
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
          jobId: input.jobId,
          agreedEndDate: businessDateKey(agreement.endDate),
          pickupDate: businessDateKey(input.completedAt),
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

  // ACTIVE: a partial pickup. Release each appliance from the agreement and credit the unused days.
  const notes: string[] = [];
  const creditIds: string[] = [];
  let creditCents = 0;
  for (const item of items) {
    if (!item.unassignedAt) {
      await tx.applianceAssignment.update({
        where: { id: item.assignmentId },
        data: { unassignedAt: input.completedAt, unassignReason: EARLY_RETURN_UNASSIGN_REASON },
      });
    }
    if (!agreement.billingStartedAt) {
      notes.push(`${item.label}: no credit, billing had not started for this agreement.`);
      continue;
    }
    if (agreement.paidInFullInAdvance) {
      notes.push(`${item.label}: no automatic credit, this rental was paid in full in advance (owner decides).`);
      continue;
    }
    const period = billingPeriodContaining(agreement.billingStartedAt, input.completedAt);
    const credit = calculateEarlyReturnCredit({
      itemLabel: item.label,
      itemMonthlyPriceCents: item.monthlyPriceCents,
      periodStart: period.start,
      periodEnd: period.end,
      returnDate: input.completedAt,
      settings,
    });
    if (credit.days === 0 || credit.amountCents === 0) {
      notes.push(`${item.label}: returned on the last day of its billed month, nothing to credit.`);
      continue;
    }
    const row = await tx.customerCredit.create({
      data: {
        customerId: agreement.customerId,
        amountCents: credit.amountCents,
        remainingCents: credit.amountCents,
        reason: credit.description,
        notes: `${credit.basis}; ${credit.days} of the ${credit.periodDays} days billed ${formatBusinessDate(period.start)} were credited.`,
        authorizedByUserId: input.userId,
        sourceType: EARLY_RETURN_CREDIT_SOURCE,
        sourceId: `${input.jobId}:${item.applianceId}`,
        side: "CUSTOMER",
      },
    });
    creditIds.push(row.id);
    creditCents += credit.amountCents;
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.early_return_credit",
        entityType: "CustomerCredit",
        entityId: row.id,
        newValue: {
          agreementId: agreement.id,
          jobId: input.jobId,
          applianceId: item.applianceId,
          description: credit.description,
          days: credit.days,
          periodDays: credit.periodDays,
          periodStart: businessDateKey(period.start),
          periodEnd: businessDateKey(period.end),
          returnDate: businessDateKey(input.completedAt),
          pickupDayNotBilled: settings.pickupDayNotBilled,
          dailyRate: formatCents(credit.dailyRateCents),
          amount: formatCents(credit.amountCents),
          basis: credit.basis,
          firstCreditedDay: credit.firstCreditedDayKey,
          lastCreditedDay: credit.lastCreditedDayKey,
          nextStep:
            "The credit is sent to Stripe so it comes off the next monthly charge. The appliance's rental line is still on the monthly subscription until it is reduced (see the owner's attention list).",
        },
      },
    });
    notes.push(`${item.label}: credit ${formatCents(credit.amountCents)} for ${credit.days} unused days.`);
  }
  return { ...EMPTY, earlyReturnCreditIds: creditIds, earlyReturnCents: creditCents, notes };
}

/**
 * Send one early-return credit to Stripe as customer-balance credit (the same
 * durable provider operation referral rewards use; src/domains/billing/
 * reconciliation.ts retries it if this attempt does not finish). Runs AFTER
 * the job-completion transaction committed, never inside it.
 */
export async function pushEarlyReturnCreditToStripe(creditId: string): Promise<void> {
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
        idempotencyKey: `early-return-credit-${creditId}`,
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
        metadata: { creditId, sourceType: EARLY_RETURN_CREDIT_SOURCE, sourceId: latest.sourceId ?? "" },
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
