import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessEndOfDay } from "@/lib/business-date";
import { agreedEndFor } from "@/domains/billing/pickup-billing-events";
import { createTaskInTx } from "@/domains/tasks";
import { closeAgreementInTx, lockRentalAgreementInTx, runCloseAgreementContinuation, type CloseAgreementResult } from "./index";

/**
 * Closing a rental once everything has come back (docs/designs/BATCH-B2.md WU-B2-9). Before this, a rental whose
 * equipment had all been picked up stayed ACTIVE (and kept billing) until someone remembered to end it.
 */

export type ReturnCloseOutcome =
  | { outcome: "CLOSED"; close: CloseAgreementResult }
  | { outcome: "EARLY_RETURN" | "RENEWAL_WAITING" | "NOT_FULLY_RETURNED" };

type TaskActor = { userId: string; role: "OWNER" | "ADMIN" | "STAFF" };

/** True when the rental had equipment out and none of it is still with the customer. */
export async function isFullyReturnedInTx(tx: Prisma.TransactionClient, agreementId: string): Promise<boolean> {
  const everOut = await tx.applianceCustodyEpisode.count({ where: { agreementId } });
  if (everOut === 0) return false;
  const stillOut = await tx.applianceCustodyEpisode.count({ where: { agreementId, closedAt: null } });
  if (stillOut > 0) return false;
  const openAssignments = await tx.applianceAssignment.findMany({
    where: { unassignedAt: null, rentalLine: { agreementId } },
    select: { applianceId: true },
  });
  if (openAssignments.length === 0) return true;
  const withCustomer = await tx.applianceCustodyEpisode.count({
    where: { closedAt: null, applianceId: { in: openAssignments.map((a) => a.applianceId) } },
  });
  return withCustomer === 0;
}

export async function closeIfFullyReturnedInTx(
  tx: Prisma.TransactionClient,
  userId: string | null,
  input: { agreementId: string; jobId: string | null; pickupDate: Date; taskActor?: TaskActor | null },
): Promise<ReturnCloseOutcome> {
  const agreement = await lockRentalAgreementInTx(tx, input.agreementId);
  if (agreement.status !== "ACTIVE") return { outcome: "NOT_FULLY_RETURNED" };
  if (!(await isFullyReturnedInTx(tx, agreement.id))) return { outcome: "NOT_FULLY_RETURNED" };

  const waiting = await tx.rentalAgreement.findFirst({
    where: { renewedFromAgreementId: agreement.id, status: "SCHEDULED" },
    select: { id: true },
  });
  if (waiting) {
    if (input.taskActor && input.jobId) {
      await createTaskInTx(tx, input.taskActor, {
        note: "Everything was picked up, but a signed renewal is waiting to start. Cancel the renewal, or bring the equipment back.",
        priority: "HIGH",
        jobId: input.jobId,
        customerId: agreement.customerId,
        sourceKey: `job:${input.jobId}:returned-renewal-waiting`,
      });
    }
    return { outcome: "RENEWAL_WAITING" };
  }

  const agreedEnd = agreedEndFor(agreement);
  if (agreedEnd && agreedEnd.getTime() <= businessEndOfDay(input.pickupDate).getTime()) {
    const close = await closeAgreementInTx(tx, userId, agreement.id, "ENDED", { endedOn: agreedEnd });
    return { outcome: "CLOSED", close };
  }
  // Returned before the agreed ending, or with no ending recorded: the owner's early-return choice decides (WU-B2-9b).
  return { outcome: "EARLY_RETURN" };
}

/**
 * Nightly: close every active rental that is fully returned and whose agreed ending has arrived (for example a
 * rental whose early return was resolved as "keep billing to the agreed end"). The pickup-day close already happened
 * at completion; this catches the rest.
 */
export async function closeFullyReturnedAgreements(now: Date = new Date()): Promise<{ closed: number }> {
  const candidates = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", OR: [{ endDate: { lte: now } }, { terminationEffectiveOn: { lte: now } }] },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let closed = 0;
  for (const { id } of candidates) {
    try {
      const result = await prisma.$transaction((tx) => closeIfFullyReturnedInTx(tx, null, { agreementId: id, jobId: null, pickupDate: now }));
      if (result.outcome === "CLOSED") {
        await runCloseAgreementContinuation(result.close);
        closed += 1;
      }
    } catch (error) {
      console.error("[cron] Could not close a fully returned rental", id, error);
    }
  }
  return { closed };
}
