import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * COM-L7 private metadata and COM-L9 private voicemail read guards.
 * A stored media state is never itself access authority.
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

/** No provider sid/URL/storage key leaves this layer except to the trusted read route. */
export async function getPrivateVoiceMediaForRead(actorId: string, mediaId: string) {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId);
    const media = await tx.communicationMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true, kind: true, state: true,
        deletedAt: true, legalHold: true, retentionUntil: true,
        privateStorageKey: true, contentHash: true,
        session: { select: { threadId: true,
          thread: { select: { assignedUserId: true } } } },
      },
    });
    if (!media || media.kind !== "VOICEMAIL" || media.state !== "AVAILABLE" ||
        media.deletedAt || !media.privateStorageKey ||
        (actor.role === "STAFF" && (!media.session.threadId ||
          media.session.thread?.assignedUserId !== actorId))) {
      return null;
    }
    if (!media.legalHold && media.retentionUntil &&
        media.retentionUntil.getTime() <= Date.now()) return null;
    if (!/^communications\/calls\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/.test(
      media.privateStorageKey,
    )) return null;
    return { privateStorageKey: media.privateStorageKey, contentHash: media.contentHash };
  });
}

/** Stable private call inbox: staff never see unassigned or unrelated calls. */
export async function listMissedCallInbox(actorId: string, cursor?: string) {
  const actor = await prisma.$transaction(async (tx) =>
    assertActiveTeamActor(tx, actorId));
  const prior = cursor && /^[A-Za-z0-9_-]{8,45}$/.test(cursor)
    ? await prisma.callSession.findUnique({
      where: { id: cursor }, select: { id: true, startedAt: true },
    }) : null;
  const page = await prisma.callSession.findMany({
    where: {
      outcome: { in: ["MISSED", "UNKNOWN", "VOICEMAIL"] },
      ...(actor.role === "STAFF" ? { thread: { assignedUserId: actorId } } : {}),
      ...(prior ? { OR: [
        { startedAt: { lt: prior.startedAt } },
        { startedAt: prior.startedAt, id: { lt: prior.id } },
      ] } : {}),
    },
    select: {
      id: true, startedAt: true, endedAt: true, state: true, outcome: true,
      media: { take: 5, orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, state: true, retentionUntil: true,
          legalHold: true, deletedAt: true } },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 31,
  });
  const rows = page.slice(0, 30);
  return { rows, next: page.length > 30 ? rows[rows.length - 1]?.id ?? null : null };
}
