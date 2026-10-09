import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * COM-L7 privacy-only domain. Provider voice ingestion and media downloads
 * deliberately do not exist until COM-L8/9 approve signature, source,
 * retention, storage and provider-call routing controls.
 */
export function dueForMediaRetentionReview(media: {
  legalHold: boolean;
  retentionUntil: Date | null;
  deletedAt: Date | null;
  state: "PENDING" | "AVAILABLE" | "FAILED" | "DELETED";
}, now = new Date()): boolean {
  return !media.legalHold && !media.deletedAt &&
    media.retentionUntil !== null && media.retentionUntil <= now &&
    media.state !== "DELETED";
}

/** Metadata only: never expose provider IDs, private object keys or raw audio. */
export async function getPrivateCallMetadata(actorId: string, sessionId: string) {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId);
    const session = await tx.callSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true, direction: true, state: true, outcome: true,
        startedAt: true, connectedAt: true, endedAt: true,
        threadId: true,
        thread: { select: { assignedUserId: true } },
        legs: { orderBy: { startedAt: "asc" }, take: 20,
          select: { id: true, role: true, status: true,
            startedAt: true, endedAt: true, durationSeconds: true } },
        media: { orderBy: { createdAt: "asc" }, take: 20,
          select: { id: true, kind: true, state: true, durationSeconds: true,
            retentionUntil: true, legalHold: true, deletedAt: true } },
      },
    });
    if (!session || (actor.role === "STAFF" &&
      (!session.threadId || session.thread?.assignedUserId !== actorId))) {
      throw new Error("Private call information not found or access denied.");
    }
    const { thread: _scopingOnly, ...safe } = session;
    void _scopingOnly;
    return safe;
  });
}

/** Owner-only queue; expiration indicates review, never permission to delete. */
export async function listMediaRetentionReview(actorId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const records = await tx.communicationMedia.findMany({
      where: { legalHold: false, deletedAt: null,
        retentionUntil: { lte: now }, state: { not: "DELETED" } },
      orderBy: [{ retentionUntil: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true, callSessionId: true, kind: true, state: true,
        retentionUntil: true, legalHold: true, deletedAt: true },
    });
    // A review queue is not a purge job: provider and all backup copies
    // must be handled as a separate confirmed, auditable workflow.
    return records.filter(m => dueForMediaRetentionReview(m, now));
  });
}
