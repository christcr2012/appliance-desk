import type { MessageDelivery, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Canonical "we actually contacted this lead" fact. Incidental Lead updates
 * (scoring, status metadata, qualification edits) must never reset win-back
 * staleness. The timestamp is monotonic so late/replayed provider events cannot
 * move contact history backwards.
 */
export async function recordRealContactInTx(
  tx: Prisma.TransactionClient,
  leadId: string,
  contactedAt: Date = new Date(),
): Promise<boolean> {
  const updated = await tx.lead.updateMany({
    where: {
      id: leadId,
      OR: [
        { lastRealContactAt: null },
        { lastRealContactAt: { lt: contactedAt } },
      ],
    },
    data: { lastRealContactAt: contactedAt },
  });
  return updated.count === 1;
}

export async function recordRealContact(
  leadId: string,
  contactedAt: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction((tx) => recordRealContactInTx(tx, leadId, contactedAt));
}

/** Accepted or delivered messages addressed to a Lead are real outbound
 * contact. Staff/internal messages merely ABOUT a lead are deliberately not. */
export async function recordLeadMessageContactInTx(
  tx: Prisma.TransactionClient,
  delivery: Pick<MessageDelivery, "recipientType" | "recipientId">,
  contactedAt: Date,
): Promise<boolean> {
  if (delivery.recipientType !== "Lead" || !delivery.recipientId) return false;
  const recorded = await recordRealContactInTx(tx, delivery.recipientId, contactedAt);
  // A message that reached the lead is also their first contact when nobody
  // has contacted them before (the same transaction, so the stored status,
  // the stage and follow-up eligibility always agree).
  await markFirstContactInTx(tx, delivery.recipientId, contactedAt);
  return recorded;
}

/**
 * LD-1: records the first real outbound contact with a lead. Sets
 * `firstContactedAt` only when it is still null, and in the same statement
 * moves a NEW lead's stored status to CONTACTED, so the stored status, the
 * screen's stage, follow-up eligibility and Today's follow-ups always agree.
 * A second call for the same lead changes nothing. Audited `lead.first_contact`.
 */
export async function markFirstContactInTx(
  tx: Prisma.TransactionClient,
  leadId: string,
  at: Date = new Date(),
): Promise<boolean> {
  const changed = await tx.$executeRaw`
    UPDATE "Lead"
    SET "firstContactedAt" = ${at},
        "status" = CASE WHEN "status" = 'NEW' THEN 'CONTACTED' ELSE "status" END
    WHERE "id" = ${leadId} AND "firstContactedAt" IS NULL
  `;
  if (changed !== 1) return false;
  await tx.auditLog.create({
    data: {
      action: "lead.first_contact",
      entityType: "Lead",
      entityId: leadId,
      newValue: { firstContactedAt: at.toISOString() },
    },
  });
  return true;
}

export async function markFirstContact(
  leadId: string,
  at: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction((tx) => markFirstContactInTx(tx, leadId, at));
}
