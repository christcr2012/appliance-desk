import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { leadContactKeys } from "./keys";
import { scoreLead } from "./scoring";
import { getLeadScoringPolicy } from "./scoring-policy";

const earlier = (a: Date | null, b: Date | null) =>
  a && b ? (a < b ? a : b) : (a ?? b);
const later = (a: Date | null, b: Date | null) =>
  a && b ? (a > b ? a : b) : (a ?? b);

/**
 * LD-1: merge one lead into another, in one transaction. Every child row
 * moves to the kept lead (notes, requests, quotes, tasks, bindings, consent
 * records, threads, deliveries, links); only empty contact fields are
 * filled from the merged lead; consent rows move with their original dates
 * and sources and are never combined or rewritten. The merged lead keeps
 * its own history and points at the kept lead so old links still resolve.
 */
export async function mergeLeads(actorId: string, keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new Error("A lead can't be merged into itself.");
  const policy = await getLeadScoringPolicy();
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    // Lock both rows in id order, so two merges of the same pair can't deadlock.
    const rows = await tx.$queryRaw<
      { id: string; status: string; mergedIntoLeadId: string | null }[]
    >`
      SELECT "id", "status", "mergedIntoLeadId" FROM "Lead"
      WHERE "id" IN (${keepId}, ${mergeId}) ORDER BY "id" ASC FOR UPDATE
    `;
    if (rows.length !== 2) throw new Error("One of those leads no longer exists.");
    const keep = rows.find((r) => r.id === keepId)!;
    const away = rows.find((r) => r.id === mergeId)!;
    if (keep.mergedIntoLeadId || away.mergedIntoLeadId) {
      throw new Error("One of those leads was already merged into another lead.");
    }
    if (keep.status === "CONVERTED" || away.status === "CONVERTED") {
      throw new Error("A converted lead can't be merged.");
    }
    // An approved or converted quote blocks the merge — the money is already real.
    const blocked = await tx.estimate.count({
      where: {
        leadId: { in: [keepId, mergeId] },
        OR: [{ status: "APPROVED" }, { customerId: { not: null } }],
      },
    });
    if (blocked > 0) {
      throw new Error("One of these leads has an approved or converted quote, so they can't be merged.");
    }

    const kept = await tx.lead.findUniqueOrThrow({ where: { id: keepId } });
    const merged = await tx.lead.findUniqueOrThrow({ where: { id: mergeId } });

    // Move every child row to the kept lead.
    await tx.leadNote.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.leadApplianceRequest.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.estimate.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.staffTask.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.contactBinding.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.consentRecord.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.communicationThread.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } });
    await tx.messageDelivery.updateMany({
      where: { recipientType: "Lead", recipientId: mergeId },
      data: { recipientId: keepId },
    });
    // Links are unique per (message, entity, id): drop the merged lead's
    // link where the kept lead already has one for the same message, then move the rest.
    const keptMessageIds = new Set(
      (
        await tx.communicationLink.findMany({
          where: { entityType: "Lead", entityId: keepId },
          select: { messageId: true },
        })
      ).map((l) => l.messageId),
    );
    await tx.communicationLink.deleteMany({
      where: { entityType: "Lead", entityId: mergeId, messageId: { in: [...keptMessageIds] } },
    });
    await tx.communicationLink.updateMany({
      where: { entityType: "Lead", entityId: mergeId },
      data: { entityId: keepId },
    });

    // Combine the kept lead: fill only empty contact fields, keep the
    // earliest first contact and latest real contact, the earliest
    // follow-up, and the further-along status (CONTACTED wins over NEW;
    // a merged-away LOST lead never changes the kept lead's status).
    const email = kept.email ?? merged.email;
    const firstContactedAt = earlier(kept.firstContactedAt, merged.firstContactedAt);
    const firstContactEstimated =
      firstContactedAt === merged.firstContactedAt && firstContactedAt !== kept.firstContactedAt
        ? merged.firstContactEstimated
        : kept.firstContactEstimated;
    const status =
      kept.status === "CONTACTED" || merged.status === "CONTACTED" ? "CONTACTED" : kept.status;
    const scored = scoreLead(
      {
        desiredTerm: kept.desiredTerm ?? merged.desiredTerm,
        quantity: kept.quantity,
        isPropertyManager: kept.isPropertyManager,
        isBusiness: kept.isBusiness,
      },
      policy,
    );
    await tx.lead.update({
      where: { id: keepId },
      data: {
        email,
        ...leadContactKeys({ phone: kept.phone, email }),
        companyName: kept.companyName ?? merged.companyName,
        addressLine1: kept.addressLine1 ?? merged.addressLine1,
        city: kept.city ?? merged.city,
        zip: kept.zip ?? merged.zip,
        bestTimeToContact: kept.bestTimeToContact ?? merged.bestTimeToContact,
        howHeard: kept.howHeard ?? merged.howHeard,
        desiredTerm: kept.desiredTerm ?? merged.desiredTerm,
        desiredStartDate: kept.desiredStartDate ?? merged.desiredStartDate,
        notes: merged.notes
          ? kept.notes
            ? `${kept.notes}\n\nFrom merged lead: ${merged.notes}`
            : `From merged lead: ${merged.notes}`
          : kept.notes,
        firstContactedAt,
        firstContactEstimated,
        lastRealContactAt: later(kept.lastRealContactAt, merged.lastRealContactAt),
        nextFollowUpOn: earlier(kept.nextFollowUpOn, merged.nextFollowUpOn),
        status,
        lostReason: status === "LOST" ? kept.lostReason : null,
        score: scored.score,
        scoreReasons: scored.reasons,
        isHighValue: scored.isHighValue,
        scoringPolicyVersion: policy.version,
        possibleDuplicateOfLeadId:
          kept.possibleDuplicateOfLeadId === mergeId ? null : kept.possibleDuplicateOfLeadId,
      },
    });

    await tx.lead.update({
      where: { id: mergeId },
      data: {
        mergedIntoLeadId: keepId,
        mergedAt: new Date(),
        status: "LOST",
        lostReason: "Merged into another lead",
        possibleDuplicateOfLeadId: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "lead.merge",
        entityType: "Lead",
        entityId: keepId,
        newValue: { mergedLeadId: mergeId },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "lead.merge",
        entityType: "Lead",
        entityId: mergeId,
        newValue: { mergedIntoLeadId: keepId },
      },
    });
  });
}
