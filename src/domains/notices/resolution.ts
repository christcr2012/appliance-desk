import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  addBusinessDays,
  businessDateFromKey,
  businessDateKey,
  businessDateTimeFromLocal,
  businessDaysBetween,
  businessEndOfDay,
  formatBusinessDate,
} from "@/lib/business-date";
import { closeAgreementInTx, runCloseAgreementContinuation, sendForSignature } from "@/domains/agreements";
import { renewAgreement } from "@/domains/agreements/term";
import { createJobInTx } from "@/domains/jobs";
import { lockUsersForScheduling } from "@/domains/jobs/scheduling";
import { createTaskInTx } from "@/domains/tasks";
import { noticeWindowState } from "./state";

/**
 * "Fix a missed reminder" (docs/archive/designs-completed/BATCH-B2.md B2-18). One screen, every option. Each option is OWNER/ADMIN,
 * re-checked inside its transaction, audited, and refused when the notice changed since the screen loaded.
 */

export type MissedNoticeChoice =
  | { kind: "CANCEL_AUTOMATIC_RENEWAL"; schedulePickup: boolean }
  | { kind: "SEND_NEW_RENEWAL"; termMonths: null | 6 | 12 }
  | { kind: "MOVE_RENEWAL_LATER" }
  | { kind: "KEEP_WAITING"; remindOn: string }
  | { kind: "END_RENTAL" }
  // Yearly reminders and terms-change notices only: billing carries on and the owner records that this was seen.
  | { kind: "ACKNOWLEDGE" };

type OptionKind = MissedNoticeChoice["kind"] | "RECORD_DELIVERY" | "CONFIRM_EMAIL";

const RESOLVABLE = ["MISSED", "UNCERTAIN", "FAILED"] as const;

async function findContext(client: Pick<Prisma.TransactionClient, "customerNotice" | "rentalAgreement">, noticeId: string) {
  const notice = await client.customerNotice.findUnique({
    where: { id: noticeId },
    select: { id: true, status: true, updatedAt: true, deadlineAt: true, earliestAt: true, agreementId: true, customerId: true, kind: true },
  });
  if (!notice) throw new Error("Couldn't find that notice.");
  const old = notice.agreementId
    ? await client.rentalAgreement.findUnique({
        where: { id: notice.agreementId },
        select: {
          id: true,
          status: true,
          endDate: true,
          termMonths: true,
          terminationRequestedAt: true,
          customerId: true,
          serviceAddressId: true,
        },
      })
    : null;
  const automatic = notice.agreementId
    ? await client.rentalAgreement.findFirst({
        where: { renewedFromAgreementId: notice.agreementId, createdByAutoRenew: true, status: "SCHEDULED" },
        select: { id: true, startDate: true },
      })
    : null;
  return { notice, old, automatic };
}

export async function getMissedNoticeOptions(noticeId: string, now = new Date()) {
  const { notice, old, automatic } = await findContext(prisma, noticeId);
  const resolvable = (RESOLVABLE as readonly string[]).includes(notice.status);
  const endLabel = old?.endDate ? formatBusinessDate(old.endDate) : "the end of its term";
  const canRenewByHand =
    resolvable &&
    old?.status === "ACTIVE" &&
    Boolean(old.termMonths && old.endDate) &&
    !old.terminationRequestedAt;
  const windowPast = noticeWindowState(notice, now) === "PAST_DEADLINE";

  const options: Array<{ kind: OptionKind; available: boolean; why: string; effect: string }> = [
    {
      kind: "CANCEL_AUTOMATIC_RENEWAL",
      available: resolvable && Boolean(automatic),
      why: automatic ? "The automatic renewal is still waiting to start." : "There is no automatic renewal waiting for this rental.",
      effect: `The rental ends on ${endLabel} and billing stops then. You can also create the pickup visit for the day after, in the same step.`,
    },
    {
      kind: "SEND_NEW_RENEWAL",
      available: canRenewByHand,
      why: canRenewByHand ? "The rental is active and still has a fixed term." : "Only an active fixed-term rental that is not ending early can be renewed this way.",
      effect: "Cancels the automatic renewal, then creates a new renewal and sends it to the customer to sign. Billing continues only after they sign; until then it ends on the current end date.",
    },
    {
      kind: "MOVE_RENEWAL_LATER",
      available: false,
      why: "A renewal has to start the day after the current term, and any renewal needs the customer's signature, so this is the same as sending a new month-to-month renewal (the option above).",
      effect: "Use “Send a new renewal” and choose month-to-month.",
    },
    {
      kind: "RECORD_DELIVERY",
      available: resolvable,
      why: "Use this if the customer was sent the reminder another way (mail, your business mailbox, a printed copy, or a text they agreed to). A phone call does not count.",
      effect: windowPast
        ? "Its last allowed day has passed, so even with a delivery record the automatic renewal still cannot start by itself."
        : "If the delivery date is inside the allowed days the automatic renewal can start normally.",
    },
    {
      kind: "CONFIRM_EMAIL",
      available: notice.status === "UNCERTAIN" || notice.status === "FAILED",
      why: "Use this after checking the email service: it either went out (with its date) or it did not.",
      effect: "“It went out” records the delivery. “It did not” puts it back in line, only while its last allowed day has not passed.",
    },
    {
      kind: "KEEP_WAITING",
      available: resolvable,
      why: "You are not ready to decide.",
      effect: "Nothing changes. A follow-up task is created for the day you pick; this stays on Today until you choose.",
    },
    {
      kind: "ACKNOWLEDGE",
      available: resolvable && notice.kind !== "RENEWAL_REMINDER",
      why:
        notice.kind === "RENEWAL_REMINDER"
          ? "A renewal reminder has to be fixed with one of the options above."
          : "This notice does not stop billing; the rental carries on.",
      effect:
        "Records that you saw it and chose to leave it. Billing is not affected. Colorado's law asks for these reminders, so consider recording a delivery by another route first.",
    },
    {
      kind: "END_RENTAL",
      available: resolvable && old?.status === "ACTIVE",
      why: old?.status === "ACTIVE" ? "The rental is active." : "The rental is not active.",
      effect: "Opens the screen for ending this rental. Nothing is changed until you finish there.",
    },
  ];
  return {
    notice: { id: notice.id, status: notice.status, updatedAt: notice.updatedAt, deadlineAt: notice.deadlineAt },
    options,
    laterStartOn: null as Date | null,
  };
}

async function recordResolution(
  tx: Prisma.TransactionClient,
  userId: string,
  noticeId: string,
  choice: MissedNoticeChoice,
  note: string,
  newStatus: string | null,
) {
  await tx.customerNotice.update({
    where: { id: noticeId },
    data: {
      resolution: `${choice.kind}: ${note}`,
      resolvedByUserId: userId,
      resolvedAt: new Date(),
      ...(newStatus ? { status: newStatus } : {}),
    },
  });
  await tx.auditLog.create({
    data: {
      userId,
      action: "notice.missed_resolved",
      entityType: "CustomerNotice",
      entityId: noticeId,
      newValue: { option: choice.kind, note, ...(newStatus ? { status: newStatus } : {}) },
    },
  });
}

export async function resolveMissedNotice(
  userId: string,
  noticeId: string,
  expectedUpdatedAt: Date,
  choice: MissedNoticeChoice,
  noteRaw: string,
): Promise<{ redirectTo: string }> {
  const note = noteRaw.trim();
  if (note.length < 2 || note.length > 500) throw new Error("Add a short note (2 to 500 characters) saying why.");
  if (choice.kind === "KEEP_WAITING" && !businessDateFromKey(choice.remindOn)) throw new Error("Pick the day you want to be reminded.");
  if (choice.kind === "SEND_NEW_RENEWAL" && ![null, 6, 12].includes(choice.termMonths)) throw new Error("Choose month-to-month, 6 or 12 months.");

  let closeLocal: Awaited<ReturnType<typeof closeAgreementInTx>> | null = null;
  let renewalPlan: { oldId: string; termMonths: number | null; startOn: Date } | null = null;
  const redirectTo = await prisma.$transaction(async (tx) => {
    await lockUsersForScheduling(tx, [userId]);
    const actor = await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const rows = await tx.$queryRaw<Array<{ status: string; updatedAt: Date }>>`
      SELECT "status", "updatedAt" FROM "CustomerNotice" WHERE "id" = ${noticeId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new Error("Couldn't find that notice.");
    if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("This changed since you opened it. Reload.");
    if (!(RESOLVABLE as readonly string[]).includes(row.status)) throw new Error("That notice no longer needs fixing.");

    const { notice, old, automatic } = await findContext(tx, noticeId);
    if (!old) throw new Error("This notice is not tied to a rental.");
    const settled = notice.status === "UNCERTAIN" ? null : "NOT_NEEDED";
    const backTo = `/desk/agreements/${old.id}`;

    switch (choice.kind) {
      case "CANCEL_AUTOMATIC_RENEWAL":
      case "SEND_NEW_RENEWAL":
      case "MOVE_RENEWAL_LATER": {
        if (!automatic) throw new Error("There is no automatic renewal waiting for this rental any more.");
        if (choice.kind !== "CANCEL_AUTOMATIC_RENEWAL" && !(old.status === "ACTIVE" && old.termMonths && old.endDate && !old.terminationRequestedAt)) {
          throw new Error("Only an active fixed-term rental that is not ending early can be renewed this way.");
        }
        closeLocal = await closeAgreementInTx(tx, userId, automatic.id, "CANCELLED");
        if (choice.kind === "CANCEL_AUTOMATIC_RENEWAL" && choice.schedulePickup && old.endDate) {
          const existing = await tx.job.findFirst({
            where: { agreementId: old.id, type: "REMOVAL", status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
            select: { id: true },
          });
          if (!existing) {
            const pickupKey = businessDateKey(addBusinessDays(businessEndOfDay(old.endDate), 1));
            const scheduledAt = businessDateTimeFromLocal(`${pickupKey}T09:00`);
            const assignments = await tx.applianceAssignment.findMany({
              where: { unassignedAt: null, rentalLine: { agreementId: old.id } },
              select: { applianceId: true },
            });
            await createJobInTx(tx, userId, {
              type: "REMOVAL",
              scheduledAt,
              customerId: old.customerId,
              serviceAddressId: old.serviceAddressId,
              agreementId: old.id,
              applianceIds: assignments.map((a) => a.applianceId),
              notes: "Pickup after the rental ended (automatic renewal cancelled from a missed reminder).",
            });
          }
        }
        if (choice.kind !== "CANCEL_AUTOMATIC_RENEWAL") {
          renewalPlan = {
            oldId: old.id,
            termMonths: choice.kind === "SEND_NEW_RENEWAL" ? choice.termMonths : null,
            startOn: addBusinessDays(businessEndOfDay(old.endDate!), 1),
          };
        }
        await recordResolution(tx, userId, noticeId, choice, note, settled);
        return backTo;
      }
      case "KEEP_WAITING": {
        await createTaskInTx(
          tx,
          { userId, role: actor.role as "OWNER" | "ADMIN" },
          {
            note: `Renewal reminder still needs a decision: ${note}`.slice(0, 500),
            dueDate: choice.remindOn,
            priority: "HIGH",
            customerId: notice.customerId,
            sourceKey: `notice-keep-waiting-${noticeId}-${choice.remindOn}`,
          },
        );
        await recordResolution(tx, userId, noticeId, choice, note, null);
        return "/desk/notices";
      }
      case "ACKNOWLEDGE": {
        if (notice.kind === "RENEWAL_REMINDER") throw new Error("A renewal reminder has to be fixed with one of the other options.");
        await recordResolution(tx, userId, noticeId, choice, note, "NOT_NEEDED");
        return "/desk/notices";
      }
      case "END_RENTAL": {
        if (old.status !== "ACTIVE") throw new Error("This rental is not active.");
        await recordResolution(tx, userId, noticeId, choice, note, null);
        return backTo;
      }
    }
  });

  // After commit: Stripe catches up with the cancelled renewal (billing ends on the old date), then the hand renewal.
  if (closeLocal) await runCloseAgreementContinuation(closeLocal);
  if (renewalPlan) {
    const plan: { oldId: string; termMonths: number | null; startOn: Date } = renewalPlan;
    let draftId: string;
    try {
      draftId = (await renewAgreement(userId, plan.oldId, { termMonths: plan.termMonths, startOn: plan.startOn })).newAgreementId;
    } catch (error) {
      throw new Error(
        `The automatic renewal was cancelled, but the new renewal could not be created: ${error instanceof Error ? error.message : "unknown problem"}. Billing will end on the current end date. Create the renewal from the rental's page.`,
      );
    }
    try {
      await sendForSignature(userId, draftId);
    } catch (error) {
      throw new Error(
        `The automatic renewal was cancelled and a new renewal was created, but it could not be sent for signature: ${error instanceof Error ? error.message : "unknown problem"}. Open the rental to send it.`,
      );
    }
  }
  return { redirectTo };
}

/** Whole days between today and a renewal start (shown on the screen). */
export function daysUntil(date: Date, now = new Date()): number {
  return businessDaysBetween(now, date);
}
