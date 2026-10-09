/**
 * A machine of a set the customer is done with — Batch W Amendment B, D-WB8 case 1 (Chris, 2026-10-09: "if one part of a
 * set is returned early, then yes, they will be charged at the standard rate for one item, unless there is an exchange").
 *
 * The machine has already left the customer (it has an open out-of-service period from the visit that took it, W-21A).
 * The owner records that it is not coming back:
 * - The machines that stay are charged their normal single prices (each type's current monthly price, less this
 *   agreement's prepaid-term discount for that many machines), never more than the line costs today.
 * - Single prices apply from the day after the pickup when the customer gave it back for good on the pickup day; when the
 *   owner decides later, the days in between are first credited as out of service (W-21A) and single prices apply from
 *   the decision day.
 * - The rest of the current billing period was already charged at the set price, so the next bill gets a credit of the
 *   difference per day (late-delivery per-day setting, rounded once, never more than billed). Stripe's monthly item
 *   changes from the next period through the durable line-change operation. Paid-in-full rentals: owner decides.
 * - The line keeps its signed history: a RentalLineAmendment records old and new price (append-only).
 */
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays, businessDateKey, businessDayBounds, businessDaysBetween, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { calculatePrepayDiscountCentsPerMonth } from "@/domains/pricing/prepay-discount";
import { getBusinessSettings } from "@/domains/settings";
import { lockRentalAgreementInTx } from "@/domains/agreements";
import { lockCustomerLedger } from "./ledger";
import { billingPeriodContaining, calculateLateDeliveryCredit, periodsBilledThrough } from "./pickup-billing";
import { loadSettings } from "./pickup-billing-events";
import { closeOutOfServiceInTx, OutOfServiceError } from "./out-of-service";
import { claimLineRepriceInTx, runLineReprice, type LineReduceClaim } from "./subscription-line";

export const SET_SINGLE_PRICE_CREDIT_SOURCE = "SET_SINGLE_PRICE";
export const TAKEN_OFF_DONE_UNASSIGN_PREFIX = "Taken off: customer done with it";

type Prepay = Parameters<typeof calculatePrepayDiscountCentsPerMonth>[2];

/** The new line price: remaining machines' single prices less the prepay discount for that many, capped at today's price. */
export function singlePriceForRemaining(input: {
  currentLinePriceCents: number;
  remainingTypePricesCents: number[];
  termMonths: number | null;
  prepay: Prepay;
}): number {
  const singles = input.remainingTypePricesCents.reduce((sum, cents) => sum + cents, 0);
  const discount = calculatePrepayDiscountCentsPerMonth(input.termMonths, input.remainingTypePricesCents.length, input.prepay);
  return Math.min(input.currentLinePriceCents, Math.max(0, singles - discount));
}

/** The day single prices start: the day after the pickup when decided for the pickup day itself, otherwise the decision day. */
export function singlePriceStart(pickedUpOn: Date, decidedOn: Date): Date {
  return businessDaysBetween(pickedUpOn, decidedOn) <= 0 ? addBusinessDays(pickedUpOn, 1) : decidedOn;
}

async function loadContext(applianceId: string) {
  const period = await prisma.outOfServicePeriod.findFirst({
    where: { applianceId, endedOn: null },
    include: {
      agreement: {
        select: {
          id: true,
          customerId: true,
          status: true,
          termMonths: true,
          billingStartedAt: true,
          paidInFullInAdvance: true,
          stripeSubscriptionId: true,
        },
      },
      rentalLine: {
        select: {
          id: true,
          label: true,
          monthlyPriceCents: true,
          assignments: {
            where: { unassignedAt: null },
            select: { id: true, applianceId: true, appliance: { select: { applianceType: { select: { name: true, monthlyPriceCents: true } } } } },
          },
        },
      },
    },
  });
  return period;
}

export type SetMachineDonePlan =
  | { eligible: false; reason: string }
  | {
      eligible: true;
      oldPriceCents: number;
      newPriceCents: number;
      remainingNames: string;
      singleFrom: Date;
      creditCents: number;
      creditDays: number;
      creditNote: string;
    };

/** What recording "the customer is done with it" on `decidedOn` would do (screen preview and the write below). */
export async function planSetMachineDone(applianceId: string, decidedOn: Date, asOf = new Date()): Promise<SetMachineDonePlan> {
  const period = await loadContext(applianceId);
  if (!period) return { eligible: false, reason: "This machine has no open repair period." };
  const others = period.rentalLine.assignments.filter((a) => a.applianceId !== applianceId);
  if (others.length === 0) {
    return { eligible: false, reason: "It is the only machine on its line, so there is no set price to change." };
  }
  if (period.agreement.status !== "ACTIVE") return { eligible: false, reason: "The rental is no longer active." };
  const settings = await getBusinessSettings();
  const newPriceCents = singlePriceForRemaining({
    currentLinePriceCents: period.rentalLine.monthlyPriceCents,
    remainingTypePricesCents: others.map((o) => o.appliance.applianceType.monthlyPriceCents),
    termMonths: period.agreement.termMonths,
    prepay: settings,
  });
  const singleFrom = singlePriceStart(period.startedOn, businessDayBounds(decidedOn).start);
  const remainingNames = others.map((o) => o.appliance.applianceType.name.toLowerCase()).join(" and ");
  const diff = period.rentalLine.monthlyPriceCents - newPriceCents;
  const base = { eligible: true as const, oldPriceCents: period.rentalLine.monthlyPriceCents, newPriceCents, remainingNames, singleFrom };
  const anchor = period.agreement.billingStartedAt;
  if (diff <= 0) return { ...base, creditCents: 0, creditDays: 0, creditNote: "The price does not change, so there is nothing to credit." };
  if (!anchor) return { ...base, creditCents: 0, creditDays: 0, creditNote: "Billing never started, so there is nothing to credit." };
  if (period.agreement.paidInFullInAdvance) {
    return { ...base, creditCents: 0, creditDays: 0, creditNote: "This rental was paid in full in advance, so you decide any refund or credit." };
  }
  // Already billed at the set price through the end of the billing period that contains today.
  const billedThrough = billingPeriodContaining(anchor, asOf).end;
  if (businessDaysBetween(singleFrom, billedThrough) <= 0) {
    return { ...base, creditCents: 0, creditDays: 0, creditNote: "Single prices start with the next bill; nothing was overcharged." };
  }
  const credit = calculateLateDeliveryCredit({
    itemLabel: remainingNames,
    itemMonthlyPriceCents: diff,
    originalDeliveryDate: singleFrom,
    actualDeliveryDate: billedThrough,
    period: billingPeriodContaining(anchor, singleFrom),
    billingAnchor: anchor,
    maxCreditCents: diff * periodsBilledThrough(anchor, new Date(billedThrough.getTime() - 1000)),
    settings: await prisma.$transaction((tx) => loadSettings(tx)),
  });
  return {
    ...base,
    creditCents: credit.amountCents,
    creditDays: credit.days,
    creditNote: `${formatCents(diff)} a month less (${credit.basis.replace(/^monthly price /, "")}) for ${credit.days} ${credit.days === 1 ? "day" : "days"} already billed.`,
  };
}

/** Record it (OWNER/ADMIN). Returns what happened in plain words. Stripe work runs after the commit. */
export async function markSetMachineDone(
  userId: string,
  input: { applianceId: string; decidedOn: Date; /** Tests only: the moment it is recorded (defaults to now). */ now?: Date },
) {
  const now = input.now ?? new Date();
  const decidedOn = businessDayBounds(input.decidedOn).start;
  if (businessDaysBetween(decidedOn, businessDayBounds(now).start) < 0) throw new OutOfServiceError("The date cannot be in the future.");
  const peek = await loadContext(input.applianceId);
  if (!peek) throw new OutOfServiceError("This machine has no open repair period. Reload the page.");
  if (businessDaysBetween(peek.startedOn, decidedOn) < 0) {
    throw new OutOfServiceError(`The date must be on or after ${formatBusinessDate(peek.startedOn)}, the day the machine was taken.`);
  }
  const plan = await planSetMachineDone(input.applianceId, decidedOn, now);
  if (!plan.eligible) throw new OutOfServiceError(plan.reason);

  const outcome = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockCustomerLedger(tx, peek.agreement.customerId);
    await lockRentalAgreementInTx(tx, peek.agreement.id);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${input.applianceId} FOR UPDATE`;
    const line = await tx.rentalLine.findUniqueOrThrow({
      where: { id: peek.rentalLineId },
      select: { id: true, monthlyPriceCents: true, assignments: { where: { unassignedAt: null }, select: { id: true, applianceId: true } } },
    });
    const still = await tx.outOfServicePeriod.findUniqueOrThrow({ where: { id: peek.id }, select: { endedOn: true } });
    if (still.endedOn || line.monthlyPriceCents !== plan.oldPriceCents || line.assignments.length !== peek.rentalLine.assignments.length) {
      throw new OutOfServiceError("This rental just changed. Reload the page and check the new numbers.");
    }
    // 1. Days between the pickup and a later decision are out-of-service days (W-21A); none when decided for the pickup day.
    const closeOn = businessDaysBetween(peek.startedOn, decidedOn) <= 0 ? peek.startedOn : decidedOn;
    const closed = await closeOutOfServiceInTx(tx, { userId, periodId: peek.id, endedOn: closeOn, reason: "CLOSED_BY_OWNER" });
    // 2. The machine leaves the line; the rest move to single prices.
    const assignment = line.assignments.find((a) => a.applianceId === input.applianceId)!;
    await tx.applianceAssignment.update({
      where: { id: assignment.id },
      data: { unassignedAt: new Date(), unassignReason: `${TAKEN_OFF_DONE_UNASSIGN_PREFIX} (single price for the rest from ${businessDateKey(plan.singleFrom)})` },
    });
    let claim: LineReduceClaim | null = null;
    let amendmentId: string | null = null;
    if (plan.newPriceCents < plan.oldPriceCents) {
      const anchor = peek.agreement.billingStartedAt;
      const amendment = await tx.rentalLineAmendment.create({
        data: {
          rentalLineId: line.id,
          outOfServicePeriodId: peek.id,
          previousMonthlyPriceCents: plan.oldPriceCents,
          newMonthlyPriceCents: plan.newPriceCents,
          effectiveFrom: anchor ? billingPeriodContaining(anchor, now).end : plan.singleFrom,
          reason: `Customer is done with one machine of the set; ${plan.remainingNames} at single price from ${formatBusinessDate(plan.singleFrom)}.`,
          createdByUserId: userId,
        },
      });
      amendmentId = amendment.id;
      await tx.rentalLine.update({ where: { id: line.id }, data: { monthlyPriceCents: plan.newPriceCents } });
      if (peek.agreement.stripeSubscriptionId) claim = await claimLineRepriceInTx(tx, { amendmentId, rentalLineId: line.id });
    }
    // 3. The rest of the current period was billed at the set price: credit the difference.
    const creditIds = closed.creditId ? [closed.creditId] : [];
    if (plan.creditCents > 0) {
      const credit = await tx.customerCredit.create({
        data: {
          customerId: peek.agreement.customerId,
          amountCents: plan.creditCents,
          remainingCents: plan.creditCents,
          reason: `Credit – single price for the ${plan.remainingNames} from ${formatBusinessDate(plan.singleFrom)} – ${plan.creditDays} ${plan.creditDays === 1 ? "day" : "days"}`,
          notes: plan.creditNote,
          authorizedByUserId: userId,
          sourceType: SET_SINGLE_PRICE_CREDIT_SOURCE,
          sourceId: amendmentId ?? peek.id,
          side: "CUSTOMER",
        },
      });
      creditIds.push(credit.id);
    }
    if (creditIds.length > 0) {
      await tx.jobBillingHandoff.createMany({
        data: creditIds.map((subjectId) => ({ jobId: peek.startJobId, kind: "PUSH_CREDIT" as const, subjectId })),
        skipDuplicates: true,
      });
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: "rental.set_machine_done",
        entityType: "RentalLine",
        entityId: line.id,
        oldValue: { monthlyPriceCents: plan.oldPriceCents },
        newValue: {
          monthlyPriceCents: plan.newPriceCents,
          applianceId: input.applianceId,
          singleFrom: businessDateKey(plan.singleFrom),
          setCreditCents: plan.creditCents,
          outOfServiceNote: closed.note,
          amendmentId,
        },
      },
    });
    const handoffs = await tx.jobBillingHandoff.findMany({
      where: { jobId: peek.startJobId, kind: "PUSH_CREDIT", subjectId: { in: creditIds } },
      select: { id: true },
    });
    return { claim, amendmentId, handoffIds: handoffs.map((h) => h.id), outOfServiceNote: closed.note };
  });

  if (outcome.claim && outcome.amendmentId) {
    // The change is saved; Stripe follows. A failure here is recorded on the provider operation and retried by billing
    // reconciliation, so it never turns a saved decision into an error on screen.
    try {
      await runLineReprice(outcome.amendmentId, outcome.claim);
    } catch (error) {
      console.error(`[W-21B] Stripe line change for amendment ${outcome.amendmentId} will be retried by reconciliation`, error);
    }
  }
  const message =
    `From ${formatBusinessDate(plan.singleFrom)} the ${plan.remainingNames} ${plan.remainingNames.includes(" and ") ? "are" : "is"} ` +
    `${formatCents(plan.newPriceCents)} a month (was ${formatCents(plan.oldPriceCents)}). ` +
    (plan.creditCents > 0 ? `The next bill has a credit of ${formatCents(plan.creditCents)}. ` : `${plan.creditNote} `) +
    outcome.outOfServiceNote;
  return { handoffIds: outcome.handoffIds, message };
}
