// OPS-6: everything Chris (or an admin) does about a customer who stopped paying. Each write locks its row and checks
// the acting team member inside the transaction. Nothing here contacts a customer except "Send", which goes through
// the normal message path (and so stays off while live email is off), and nothing moves money.
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { deliverMessage } from "@/domains/messaging/deliver";
import { ensurePickupDraftInTx } from "@/domains/agreements/pickup-draft";
import { readNoticeWording } from "./engine";
import { renderFinalNotice, renderSecondNotice } from "./templates";
import { businessDateKey } from "@/lib/business-date";
import { daysPastDue, pickupGate, validateLadder, wordingProblem, type LadderDays } from "./rules";

export class CollectionError extends Error {}

const clean = (value: string, max = 500) => value.trim().slice(0, max);

const longDate = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" });

/**
 * A waiting notice names an amount. If the bill was part-paid after it was written, rewrite it with today's balance
 * (current wording) and say so: the person sending must read the new text before it goes. Returns true when it changed.
 */
export async function refreshNoticeIfStale(stepId: string): Promise<boolean> {
  const wording = await readNoticeWording();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CollectionStep" WHERE "id" = ${stepId} FOR UPDATE`;
    const row = await tx.collectionStep.findUnique({
      where: { id: stepId },
      include: { invoice: { select: { invoiceNumber: true, dueDate: true, amountDueCents: true, amountPaidCents: true } }, customer: { select: { user: { select: { name: true } } } } },
    });
    if (!row || row.state !== "WAITING" || (row.kind !== "SECOND_NOTICE" && row.kind !== "FINAL_NOTICE") || !row.invoice.dueDate) return false;
    const owed = Math.max(0, row.invoice.amountDueCents - row.invoice.amountPaidCents);
    if (owed <= 0 || owed === row.amountOwedCents) return false;
    const facts = {
      customerName: row.customer.user.name ?? "there", invoiceNumber: row.invoice.invoiceNumber, owedCents: owed,
      dueOnText: longDate(row.invoice.dueDate), daysPastDue: daysPastDue(businessDateKey(row.invoice.dueDate), businessDateKey(new Date())), ...wording,
    };
    const draft = row.kind === "FINAL_NOTICE" ? renderFinalNotice(facts) : renderSecondNotice(facts);
    await tx.collectionStep.update({ where: { id: stepId }, data: { amountOwedCents: owed, subject: draft.subject, body: draft.body } });
    return true;
  });
}

/** Send an approved notice. The first press sends; a repeat finds the same message (one idempotency key). */
export async function sendNotice(actorUserId: string, stepId: string): Promise<{ sent: boolean; message: string }> {
  await prisma.$transaction((tx) => assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]));
  if (await refreshNoticeIfStale(stepId)) {
    throw new CollectionError("The customer paid part of this bill since the notice was written, so the notice now shows the new amount. Read it again, then press Send.");
  }
  const step = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "CollectionStep" WHERE "id" = ${stepId} FOR UPDATE`;
    const row = await tx.collectionStep.findUnique({
      where: { id: stepId },
      include: { invoice: { select: { amountDueCents: true, amountPaidCents: true, invoiceNumber: true, agreementId: true } }, customer: { select: { id: true, user: { select: { email: true } } } } },
    });
    if (!row) throw new CollectionError("Couldn't find that notice.");
    if (row.kind !== "SECOND_NOTICE" && row.kind !== "FINAL_NOTICE") throw new CollectionError("That step is a decision, not a notice.");
    if (row.state !== "WAITING") throw new CollectionError("That notice was already handled.");
    if (row.invoice.amountDueCents - row.invoice.amountPaidCents <= 0) {
      await tx.collectionStep.update({ where: { id: stepId }, data: { state: "SKIPPED", note: "Paid before it was sent.", decidedAt: new Date(), decidedByUserId: actorUserId } });
      throw new CollectionError("This bill has been paid, so no notice is needed.");
    }
    return row;
  });
  if (!step.subject || !step.body) throw new CollectionError("This notice has no text.");
  const result = await deliverMessage({
    idempotencyKey: `collection-${step.id}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: step.kind === "FINAL_NOTICE" ? "collection-final-notice" : "collection-second-notice",
    customerFacing: true,
    recipient: { type: "Customer", id: step.customer.id, address: step.customer.user.email },
    subject: { type: "Invoice", id: step.invoiceId },
    render: () => ({ subject: step.subject!, text: step.body! }),
  });
  // Only a message the email service has confirmed counts as sent. An uncertain or still-pending one stays on the list.
  const went = result.state === "ACCEPTED" || result.state === "DELIVERED";
  const uncertain = result.state === "UNKNOWN" || result.state === "PENDING";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CollectionStep" WHERE "id" = ${stepId} FOR UPDATE`;
    if (went) {
      await tx.collectionStep.updateMany({ where: { id: stepId, state: "WAITING" }, data: { state: "SENT", decidedAt: new Date(), decidedByUserId: actorUserId, deliveryId: result.deliveryId } });
      await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.notice_sent", entityType: "CollectionStep", entityId: stepId, newValue: { kind: step.kind, deliveryState: result.state } } });
    } else if (uncertain) {
      await tx.collectionStep.updateMany({ where: { id: stepId, state: "WAITING" }, data: { deliveryId: result.deliveryId } });
    }
  });
  if (uncertain) return { sent: false, message: "We can't confirm yet that the email went out. It stays on your list; press Send again in a few minutes and it will check (it will not send twice)." };
  return went
    ? { sent: true, message: "Sent." }
    : { sent: false, message: "It wasn't sent (live email is off, or the address can't receive it). It stays on your list; you can print the letter instead." };
}

export async function skipNotice(actorUserId: string, stepId: string, reason: string): Promise<void> {
  const note = clean(reason);
  if (!note) throw new CollectionError("Say briefly why you're skipping it.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "CollectionStep" WHERE "id" = ${stepId} FOR UPDATE`;
    const row = await tx.collectionStep.findUnique({ where: { id: stepId } });
    if (!row || row.state !== "WAITING") throw new CollectionError("That step was already handled.");
    await tx.collectionStep.update({ where: { id: stepId }, data: { state: "SKIPPED", note, decidedAt: new Date(), decidedByUserId: actorUserId } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.step_skipped", entityType: "CollectionStep", entityId: stepId, newValue: { note } } });
  });
}

/** The day-30 decision: record what Chris chose. "Small claims" makes the small-claims step; the others just close the step. */
export async function recordDecision(actorUserId: string, stepId: string, choice: "PAYMENT_PLAN" | "PICKUP" | "SMALL_CLAIMS" | "WAIT", note: string): Promise<void> {
  const text = clean(note);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "CollectionStep" WHERE "id" = ${stepId} FOR UPDATE`;
    const row = await tx.collectionStep.findUnique({ where: { id: stepId } });
    if (!row || row.kind !== "DECISION") throw new CollectionError("Couldn't find that decision.");
    if (row.state !== "WAITING") throw new CollectionError("That decision was already recorded.");
    if (choice === "PAYMENT_PLAN" && !text) throw new CollectionError("Write down the plan you agreed (amounts and dates).");
    await tx.collectionStep.update({ where: { id: stepId }, data: { state: "DONE", note: `${choice}${text ? `: ${text}` : ""}`, decidedAt: new Date(), decidedByUserId: actorUserId } });
    if (choice === "SMALL_CLAIMS") {
      await tx.collectionStep.createMany({
        data: [{ invoiceId: row.invoiceId, customerId: row.customerId, kind: "SMALL_CLAIMS", cameUpOn: new Date(), amountOwedCents: row.amountOwedCents }],
        skipDuplicates: true,
      });
    }
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.decision", entityType: "CollectionStep", entityId: stepId, newValue: { choice, note: text } } });
  });
}

async function lockedCase(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], agreementId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CollectionCase" WHERE "agreementId" = ${agreementId} FOR UPDATE`;
  const row = await tx.collectionCase.findUnique({ where: { agreementId } });
  if (!row) throw new CollectionError("Couldn't find that account's collection record.");
  return row;
}

export async function recordPickupConsent(actorUserId: string, agreementId: string, input: { how: string; note?: string }): Promise<void> {
  const how = clean(input.how, 200);
  if (!how) throw new CollectionError("Say how the customer agreed (phone call, text, in person).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const row = await lockedCase(tx, agreementId);
    const note = input.note ? clean(input.note) : null;
    await tx.collectionCase.update({ where: { id: row.id }, data: { pickupConsentAt: new Date(), pickupConsentHow: note ? `${how} — ${note}` : how, pickupConsentByUserId: actorUserId } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.pickup_consent", entityType: "CollectionCase", entityId: row.id, newValue: { how } } });
  });
}

export async function recordCourtOrder(actorUserId: string, agreementId: string, input: { orderedOn: Date; note: string }): Promise<void> {
  const note = clean(input.note);
  if (!note) throw new CollectionError("Write the court and case number.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const row = await lockedCase(tx, agreementId);
    await tx.collectionCase.update({ where: { id: row.id }, data: { courtOrderOn: input.orderedOn, courtOrderNote: note } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.court_order", entityType: "CollectionCase", entityId: row.id, newValue: { note } } });
  });
}

/**
 * Make the (unscheduled) pickup visit after a default. Allowed only with the customer's recorded agreement or a court
 * order, and never for a customer marked on active military duty unless a court order is recorded.
 */
export async function createCollectionPickup(actorUserId: string, agreementId: string): Promise<{ jobId: string }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const row = await lockedCase(tx, agreementId);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: row.customerId }, select: { activeMilitary: true } });
    const gate = pickupGate({ consentAt: row.pickupConsentAt, activeDuty: customer.activeMilitary, courtOrderOn: row.courtOrderOn });
    if (!gate.ok) throw new CollectionError(gate.message);
    const jobId = await ensurePickupDraftInTx(tx, agreementId, {
      notes: "Pickup after missed payments. The customer agreed to this pickup. If the customer objects at the door, stop and leave: do not take the appliance. Use Customer objected on this visit.",
    });
    if (!jobId) throw new CollectionError("No appliance is still at the customer's, so there is nothing to pick up.");
    await tx.collectionCase.update({ where: { id: row.id }, data: { pickupJobId: jobId } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.pickup_created", entityType: "CollectionCase", entityId: row.id, newValue: { jobId } } });
    return { jobId };
  });
}

/** "Customer objected": the visit ends with nothing taken, and the small-claims step comes up. */
export async function customerObjected(actorUserId: string, agreementId: string, note: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN", "STAFF"]);
    const row = await lockedCase(tx, agreementId);
    if (row.objectedAt) return;
    const text = clean(note) || "Customer objected at the door.";
    if (row.pickupJobId) {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${row.pickupJobId} FOR UPDATE`;
      await tx.job.updateMany({ where: { id: row.pickupJobId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } }, data: { status: "CANCELLED", outcomeNotes: `Customer objected — nothing taken. ${text}` } });
    }
    await tx.collectionCase.update({ where: { id: row.id }, data: { objectedAt: new Date(), objectedNote: text } });
    const bill = await tx.invoice.findFirst({
      where: { agreementId, status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] } },
      orderBy: { dueDate: "asc" }, select: { id: true, amountDueCents: true, amountPaidCents: true },
    });
    if (bill) {
      await tx.collectionStep.createMany({
        data: [{ invoiceId: bill.id, customerId: row.customerId, kind: "SMALL_CLAIMS", cameUpOn: new Date(), amountOwedCents: Math.max(0, bill.amountDueCents - bill.amountPaidCents) }],
        skipDuplicates: true,
      });
    }
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.customer_objected", entityType: "CollectionCase", entityId: row.id, newValue: { note: text } } });
  });
}

export async function recordSmallClaimsFiling(actorUserId: string, input: { agreementId: string | null; county: string; filedOn: Date; amountCents: number; feeCents: number; note?: string; stepId?: string }): Promise<void> {
  const county = clean(input.county, 80);
  if (!county) throw new CollectionError("Say which county you filed in.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new CollectionError("The amount claimed must be more than zero.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.smallClaimsFiling.create({ data: { county, filedOn: input.filedOn, amountCents: input.amountCents, feeCents: input.feeCents, agreementId: input.agreementId, recordedByUserId: actorUserId, note: input.note ? clean(input.note) : null } });
    if (input.agreementId) await tx.collectionStep.updateMany({ where: { kind: "SMALL_CLAIMS", state: "WAITING", invoice: { agreementId: input.agreementId } }, data: { state: "DONE", note: `Filed in ${county}`, decidedAt: new Date(), decidedByUserId: actorUserId } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "collections.small_claims_filed", entityType: "SmallClaimsFiling", entityId: input.agreementId ?? "none", newValue: { county, amountCents: input.amountCents } } });
  });
}

export async function saveLadder(actorUserId: string, days: LadderDays): Promise<void> {
  const problem = validateLadder(days);
  if (problem) throw new CollectionError(problem);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { collectionSecondNoticeDay: true, collectionFinalNoticeDay: true, collectionDecisionDay: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { collectionSecondNoticeDay: days.secondNotice, collectionFinalNoticeDay: days.finalNotice, collectionDecisionDay: days.decision } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.collection_ladder", entityType: "BusinessSettings", entityId: "singleton", oldValue: before, newValue: days } });
  });
}

/** Owner-only: the "how to pay" line and the "if something has gone wrong" line used in new notices. Empty = recommended text. */
export async function saveNoticeWording(actorUserId: string, input: { payHowText: string; helpText: string }): Promise<void> {
  const payHow = clean(input.payHowText, 600);
  const help = clean(input.helpText, 600);
  for (const text of [payHow, help]) {
    const problem = wordingProblem(text);
    if (problem) throw new CollectionError(problem);
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { collectionPayHowText: true, collectionHelpText: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { collectionPayHowText: payHow || null, collectionHelpText: help || null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.collection_wording", entityType: "BusinessSettings", entityId: "singleton", oldValue: before, newValue: { payHowText: payHow || null, helpText: help || null } } });
  });
}
