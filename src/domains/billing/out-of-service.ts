/**
 * Machines out for repair with no replacement yet — Batch W Amendment B, D-WB8 case 3 (Chris, 2026-10-09: "If I brought
 * one back, but I don't have a replacement ready, then they should be prorated on the next month for any time that they
 * did not have the item"). Applies to any rental line, set or single machine.
 *
 * - A period OPENS when a visit takes a machine and the rental goes on: a swap visit that took the old machine without
 *   delivering the new one, or a pickup of some (not all) machines while others stay at the customer. Taking every
 *   machine back is the existing early-return path, not this.
 * - It CLOSES when a machine is back on that line: a swap delivers a replacement, the owner records the same machine
 *   delivered back, or the owner closes it. The customer is credited that machine's share of the line price for each
 *   day without it — the pickup day counts as without, the day a machine arrives counts as with — using the
 *   late-delivery per-day setting, rounded once, never more than was billed. The credit is a CustomerCredit
 *   (sourceType OUT_OF_SERVICE) sent to Stripe as account-balance credit, so it comes off the next bill as its own line.
 * - Lock order everywhere: agreement → appliance → period.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey, businessDayBounds, businessDaysBetween, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import { lockRentalAgreementInTx } from "@/domains/agreements";
import { billingPeriodContaining, calculateLateDeliveryCredit, periodsBilledThrough } from "./pickup-billing";
import { itemsForAppliances, loadSettings } from "./pickup-billing-events";

export const OUT_OF_SERVICE_CREDIT_SOURCE = "OUT_OF_SERVICE";
export type OutOfServiceEndReason = "REPLACED" | "SAME_MACHINE_BACK" | "CLOSED_BY_OWNER";

export class OutOfServiceError extends Error {}

/**
 * Called by job completion (same transaction, agreement and appliances already locked) for machines the visit took.
 * `alwaysOpen` is true for a swap that took the old machine without delivering the new one (it is explicitly "taken for
 * repair"); for a pickup a period opens only while another machine of the rental is still at the customer.
 */
export async function openOutOfServiceInTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobId: string; applianceIds: string[]; serviceDate: Date; alwaysOpen: boolean },
): Promise<string[]> {
  const notes: string[] = [];
  for (const applianceId of input.applianceIds) {
    const assignment = await tx.applianceAssignment.findFirst({
      where: { applianceId, unassignedAt: null },
      select: {
        rentalLineId: true,
        rentalLine: { select: { agreementId: true, agreement: { select: { status: true } } } },
        appliance: { select: { assetNumber: true } },
      },
    });
    if (!assignment || assignment.rentalLine.agreement.status !== "ACTIVE") continue;
    const agreementId = assignment.rentalLine.agreementId;
    if (!input.alwaysOpen) {
      const stillAtCustomer = await tx.applianceCustodyEpisode.count({
        where: {
          closedAt: null,
          applianceId: { not: applianceId },
          appliance: { assignments: { some: { unassignedAt: null, rentalLine: { agreementId } } } },
        },
      });
      if (stillAtCustomer === 0) continue;
    }
    const open = await tx.outOfServicePeriod.findFirst({ where: { applianceId, endedOn: null }, select: { id: true } });
    if (open) continue;
    const period = await tx.outOfServicePeriod.upsert({
      where: { startJobId_applianceId: { startJobId: input.jobId, applianceId } },
      update: {},
      create: {
        agreementId,
        rentalLineId: assignment.rentalLineId,
        applianceId,
        startedOn: input.serviceDate,
        startJobId: input.jobId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "rental.out_of_service.open",
        entityType: "OutOfServicePeriod",
        entityId: period.id,
        newValue: { agreementId, applianceId, startedOn: businessDateKey(input.serviceDate), jobId: input.jobId },
      },
    });
    notes.push(`${assignment.appliance.assetNumber} is out for repair from ${formatBusinessDate(input.serviceDate)}; the customer is credited the days without it once a machine is back.`);
  }
  return notes;
}

type CreditPlan =
  | { kind: "credit"; amountCents: number; days: number; description: string; basis: string }
  | { kind: "none"; reason: string };

/** What closing a period on `endedOn` credits the customer (no writes). */
export async function outOfServiceCreditPlan(
  tx: Prisma.TransactionClient,
  period: { agreementId: string; applianceId: string; startedOn: Date },
  endedOn: Date,
): Promise<CreditPlan> {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: period.agreementId },
    select: { billingStartedAt: true, paidInFullInAdvance: true },
  });
  if (!agreement.billingStartedAt) return { kind: "none", reason: "billing never started for this rental" };
  if (agreement.paidInFullInAdvance) return { kind: "none", reason: "this rental was paid in full in advance, so the owner decides any credit" };
  const [item] = await itemsForAppliances(tx, period.agreementId, [period.applianceId]);
  if (!item) return { kind: "none", reason: "the machine is no longer on this rental" };
  const typeName = item.label.split(" #")[0]!.toLowerCase();
  // Days before billing started were never billed, so they are never credited.
  const from = businessDaysBetween(period.startedOn, agreement.billingStartedAt) > 0
    ? businessDayBounds(agreement.billingStartedAt).start
    : period.startedOn;
  const dayBefore = new Date(endedOn.getTime() - 1000);
  const credit = calculateLateDeliveryCredit({
    itemLabel: typeName,
    itemMonthlyPriceCents: item.monthlyPriceCents,
    originalDeliveryDate: from,
    actualDeliveryDate: endedOn,
    period: billingPeriodContaining(agreement.billingStartedAt, from),
    billingAnchor: agreement.billingStartedAt,
    maxCreditCents: item.monthlyPriceCents * periodsBilledThrough(agreement.billingStartedAt, dayBefore),
    settings: await loadSettings(tx),
  });
  if (credit.days === 0 || credit.amountCents === 0) return { kind: "none", reason: "no billed day was without the machine" };
  return {
    kind: "credit",
    amountCents: credit.amountCents,
    days: credit.days,
    description: `Credit – ${typeName} out of service – ${credit.days} ${credit.days === 1 ? "day" : "days"}`,
    basis: credit.basis,
  };
}

/** Close an open period (caller holds the agreement and appliance locks) and write its credit. Idempotent per period. */
export async function closeOutOfServiceInTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    periodId: string;
    endedOn: Date;
    reason: OutOfServiceEndReason;
    endJobId?: string | null;
    replacementApplianceId?: string | null;
  },
): Promise<{ creditId: string | null; note: string }> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "OutOfServicePeriod" WHERE "id" = ${input.periodId} AND "endedOn" IS NULL FOR UPDATE
  `;
  if (locked.length === 0) {
    const done = await tx.outOfServicePeriod.findUnique({ where: { id: input.periodId }, select: { creditId: true } });
    return { creditId: done?.creditId ?? null, note: "This repair period was already closed." };
  }
  const period = await tx.outOfServicePeriod.findUniqueOrThrow({
    where: { id: input.periodId },
    include: { agreement: { select: { customerId: true } }, appliance: { select: { assetNumber: true } } },
  });
  if (businessDaysBetween(period.startedOn, input.endedOn) < 0) {
    throw new OutOfServiceError(`The date must be on or after ${formatBusinessDate(period.startedOn)}, the day the machine was taken.`);
  }
  const plan = await outOfServiceCreditPlan(tx, period, input.endedOn);
  let creditId: string | null = null;
  if (plan.kind === "credit") {
    const credit = await tx.customerCredit.create({
      data: {
        customerId: period.agreement.customerId,
        amountCents: plan.amountCents,
        remainingCents: plan.amountCents,
        reason: plan.description,
        notes: `${plan.basis}; without it from ${formatBusinessDate(period.startedOn)} through the day before ${formatBusinessDate(input.endedOn)}.`,
        authorizedByUserId: input.userId,
        sourceType: OUT_OF_SERVICE_CREDIT_SOURCE,
        sourceId: period.id,
        side: "CUSTOMER",
      },
    });
    creditId = credit.id;
  }
  await tx.outOfServicePeriod.update({
    where: { id: period.id },
    data: {
      endedOn: input.endedOn,
      endReason: input.reason,
      endJobId: input.endJobId ?? null,
      replacementApplianceId: input.replacementApplianceId ?? null,
      creditId,
      closedByUserId: input.userId,
      closedAt: new Date(),
    },
  });
  const note =
    plan.kind === "credit"
      ? `${period.appliance.assetNumber}: ${plan.description}, ${formatCents(plan.amountCents)} — comes off the next bill.`
      : `${period.appliance.assetNumber}: back in service; no credit because ${plan.reason}.`;
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: "rental.out_of_service.close",
      entityType: "OutOfServicePeriod",
      entityId: period.id,
      newValue: {
        reason: input.reason,
        endedOn: businessDateKey(input.endedOn),
        creditId,
        amount: plan.kind === "credit" ? formatCents(plan.amountCents) : null,
        days: plan.kind === "credit" ? plan.days : 0,
        note,
      },
    },
  });
  return { creditId, note };
}

/** A swap delivered a replacement for a machine that was out for repair: close its period (job completion). */
export async function closeOutOfServiceForSwapInTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobId: string; originalId: string; replacementId: string; serviceDate: Date },
) {
  const open = await tx.outOfServicePeriod.findFirst({ where: { applianceId: input.originalId, endedOn: null }, select: { id: true } });
  if (!open) return null;
  return closeOutOfServiceInTx(tx, {
    userId: input.userId,
    periodId: open.id,
    endedOn: input.serviceDate,
    reason: "REPLACED",
    endJobId: input.jobId,
    replacementApplianceId: input.replacementId,
  });
}

/** The open period for a machine, with what the owner needs to decide (screen and To do). */
export async function getOpenOutOfService(applianceId: string) {
  return prisma.outOfServicePeriod.findFirst({
    where: { applianceId, endedOn: null },
    include: {
      appliance: { select: { id: true, assetNumber: true, status: true, applianceType: { select: { name: true } } } },
      agreement: {
        select: {
          id: true,
          customerId: true,
          serviceAddressId: true,
          customer: { select: { user: { select: { name: true, email: true } } } },
        },
      },
      rentalLine: { select: { label: true } },
    },
  });
}

/** Today's credit if the machine were back today (the screen shows it). */
export async function previewOutOfServiceCredit(periodId: string, asOf: Date) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.outOfServicePeriod.findUniqueOrThrow({ where: { id: periodId } });
    return outOfServiceCreditPlan(tx, period, businessDayBounds(asOf).start);
  });
}

/**
 * Owner actions (OWNER/ADMIN): the same machine came back repaired, or close the period without a replacement. Both
 * credit the days without it. Returns the credit id so the caller can hand it to Stripe after the commit.
 */
export async function resolveOutOfService(
  userId: string,
  input: { applianceId: string; how: "SAME_MACHINE_BACK" | "CLOSED_BY_OWNER"; on: Date },
): Promise<{ creditId: string | null; note: string; startJobId: string }> {
  const today = businessDayBounds(new Date()).start;
  const on = businessDayBounds(input.on).start;
  if (businessDaysBetween(on, today) < 0) throw new OutOfServiceError("The date cannot be in the future.");
  const peek = await prisma.outOfServicePeriod.findFirst({
    where: { applianceId: input.applianceId, endedOn: null },
    select: { id: true, agreementId: true },
  });
  if (!peek) throw new OutOfServiceError("This machine has no open repair period. Reload the page.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockRentalAgreementInTx(tx, peek.agreementId);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${input.applianceId} FOR UPDATE`;
    const period = await tx.outOfServicePeriod.findUniqueOrThrow({
      where: { id: peek.id },
      include: { agreement: { select: { customerId: true, serviceAddressId: true } } },
    });
    if (period.endedOn) throw new OutOfServiceError("This repair period was already closed. Reload the page.");
    if (input.how === "SAME_MACHINE_BACK") {
      const assigned = await tx.applianceAssignment.findFirst({
        where: { applianceId: input.applianceId, unassignedAt: null, rentalLineId: period.rentalLineId },
        select: { id: true },
      });
      if (!assigned) throw new OutOfServiceError("This machine is no longer on that rental, so it can't be recorded as delivered back.");
      if (await tx.applianceCustodyEpisode.findFirst({ where: { applianceId: input.applianceId, closedAt: null }, select: { id: true } })) {
        throw new OutOfServiceError("This machine is already recorded as being with a customer.");
      }
      await tx.applianceCustodyEpisode.create({
        data: {
          applianceId: input.applianceId,
          customerId: period.agreement.customerId,
          serviceAddressId: period.agreement.serviceAddressId,
          agreementId: period.agreementId,
          startedOn: on,
          startEvidence: "MANUAL",
        },
      });
      const before = await tx.appliance.findUniqueOrThrow({ where: { id: input.applianceId }, select: { status: true } });
      await tx.appliance.update({ where: { id: input.applianceId }, data: { status: "RENTED" } });
      await tx.auditLog.create({
        data: {
          userId,
          action: "appliance.unit.status",
          entityType: "Appliance",
          entityId: input.applianceId,
          oldValue: { status: before.status },
          newValue: { status: "RENTED", reason: "Delivered back after repair" },
        },
      });
    }
    const closed = await closeOutOfServiceInTx(tx, { userId, periodId: period.id, endedOn: on, reason: input.how });
    if (closed.creditId) {
      await tx.jobBillingHandoff.createMany({
        data: [{ jobId: period.startJobId, kind: "PUSH_CREDIT", subjectId: closed.creditId }],
        skipDuplicates: true,
      });
    }
    return { ...closed, startJobId: period.startJobId };
  });
}
