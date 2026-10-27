// OPS-5: what the owner or an admin does about a dispute. Nothing here runs without a person pressing a button:
// "Approve and send" answers a card dispute ONCE with the evidence packet, "Mark handled" closes the bank follow-up,
// "Allow bank autopay again" clears the block a bank dispute put on a customer.
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { gatherPacketData, loadPrivatePhoto } from "./packet";
import { renderEvidencePacket, type PhotoLoader } from "./packet-render";
import { clampWindowDays, isFinalState, type DisputeStateName } from "./rules";

export class DisputeError extends Error {}

/** A claim older than this is treated as a send that never finished (the server stopped), and may be tried again. */
const CLAIM_STALE_MS = 15 * 60 * 1000;

export type SubmitDeps = { loadPhoto?: PhotoLoader; now?: Date };

/**
 * "Approve and send": build the packet from our records, upload it to Stripe and submit the dispute. One submission
 * only: the dispute is claimed in the database first, so a double tap or two people at once send it once.
 */
export async function approveAndSendEvidence(actorUserId: string, disputeId: string, deps: SubmitDeps = {}): Promise<{ bytes: number; photosIncluded: number; photosDropped: number }> {
  const now = deps.now ?? new Date();
  // 1. Claim it (short transaction, no network).
  const claimed = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
    const dispute = await tx.paymentDispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new DisputeError("Couldn't find that dispute.");
    if (dispute.isBank) throw new DisputeError("Bank disputes can't be contested. Collect from the customer directly.");
    if (dispute.state !== "NEEDS_RESPONSE") throw new DisputeError("This dispute is no longer waiting for an answer.");
    if (dispute.evidenceSubmittedAt) {
      const inProgress = !dispute.evidenceFileId && now.getTime() - dispute.evidenceSubmittedAt.getTime() < CLAIM_STALE_MS;
      throw new DisputeError(inProgress ? "The answer is being sent right now." : "The answer was already sent. Stripe accepts only one.");
    }
    if (dispute.dueBy && dispute.dueBy.getTime() < now.getTime()) throw new DisputeError("The deadline has passed, so Stripe no longer accepts an answer.");
    await tx.paymentDispute.update({ where: { id: disputeId }, data: { evidenceSubmittedAt: now, evidenceSubmittedByUserId: actorUserId, evidenceFileId: null } });
    return dispute;
  });

  // 2. Build and send, with no database lock held.
  try {
    const data = await gatherPacketData(disputeId, now);
    const packet = await renderEvidencePacket(data, deps.loadPhoto ?? loadPrivatePhoto);
    const stripe = getStripeClient();
    const file = await stripe.files.create({
      purpose: "dispute_evidence",
      file: { data: Buffer.from(packet.pdf), name: `dispute-${claimed.stripeDisputeId}-evidence.pdf`, type: "application/pdf" },
    });
    const summary = `Evidence packet from ${data.businessName}: signed rental agreement, delivery record, the bill and payments, messages to the customer, and the refund terms.`;
    await stripe.disputes.update(claimed.stripeDisputeId, {
      evidence: {
        customer_name: data.customer.name,
        ...(data.customer.email ? { customer_email_address: data.customer.email } : {}),
        service_documentation: file.id,
        uncategorized_file: file.id,
        uncategorized_text: summary.slice(0, 20_000),
      },
      submit: true,
    });
    await prisma.$transaction(async (tx) => {
      await tx.paymentDispute.update({
        where: { id: disputeId },
        data: {
          evidenceFileId: file.id, evidencePacketBytes: packet.bytes,
          evidenceSummary: { photosIncluded: packet.photosIncluded, photosDropped: packet.photosDropped, messages: data.messages.length },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId, action: "dispute.evidence_sent", entityType: "PaymentDispute", entityId: disputeId,
          newValue: { bytes: packet.bytes, photosIncluded: packet.photosIncluded, photosDropped: packet.photosDropped },
        },
      });
    });
    return { bytes: packet.bytes, photosIncluded: packet.photosIncluded, photosDropped: packet.photosDropped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // Stripe already has an answer: remember that, never send a second one.
    if (/already (been )?submitted|evidence.*submitted/i.test(message)) {
      await prisma.paymentDispute.update({ where: { id: disputeId }, data: { evidenceFileId: "already-with-stripe" } });
      throw new DisputeError("Stripe says an answer was already sent for this dispute.");
    }
    // Nothing reached Stripe: give the button back so it can be tried again.
    await prisma.paymentDispute.updateMany({
      where: { id: disputeId, evidenceFileId: null },
      data: { evidenceSubmittedAt: null, evidenceSubmittedByUserId: null },
    });
    if (error instanceof DisputeError) throw error;
    throw new DisputeError("The answer could not be sent to Stripe. Nothing was submitted; you can try again. " + (message ? `(${message.slice(0, 160)})` : ""));
  }
}

/** Bank dispute follow-up: Chris says the "collect directly" To do is dealt with. */
export async function markBankDisputeHandled(actorUserId: string, disputeId: string, note: string): Promise<void> {
  const text = note.trim().slice(0, 500);
  if (!text) throw new DisputeError("Say briefly how it was handled (for example: customer paid by check on Friday).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
    const dispute = await tx.paymentDispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new DisputeError("Couldn't find that dispute.");
    if (dispute.handledAt) return;
    await tx.paymentDispute.update({ where: { id: disputeId }, data: { handledAt: new Date(), handledByUserId: actorUserId, handledNote: text } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "dispute.handled", entityType: "PaymentDispute", entityId: disputeId, newValue: { note: text } } });
  });
}

/** Chris decides this customer may use bank autopay again (for example after a new signed bank authorization). */
export async function clearBankDebitBlock(actorUserId: string, customerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { bankDebitBlockedAt: true } });
    if (!customer?.bankDebitBlockedAt) return;
    await tx.customer.update({ where: { id: customerId }, data: { bankDebitBlockedAt: null, bankDebitBlockedReason: null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "dispute.bank_block_cleared", entityType: "Customer", entityId: customerId } });
  });
}

/** Owner setting: how many days after a bank debit a deposit refund waits. */
export async function saveAchDisputeWindowDays(actorUserId: string, days: number): Promise<number> {
  const value = clampWindowDays(days);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const before = await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { achDisputeWindowDays: true } });
    if (before.achDisputeWindowDays === value) return;
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { achDisputeWindowDays: value } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "settings.ach_dispute_window", entityType: "BusinessSettings", entityId: "singleton", oldValue: { days: before.achDisputeWindowDays }, newValue: { days: value } } });
  });
  return value;
}

export { isFinalState };
export type { DisputeStateName };
