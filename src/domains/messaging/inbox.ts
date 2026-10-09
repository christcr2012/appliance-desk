import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { decryptCommunicationContent } from "./communications-content";

type Filters = {
  status?: "OPEN" | "WAITING" | "CLOSED";
  resolution?: "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS";
  assignment?: "mine" | "unassigned" | "all";
};
type Cursor = { lastActivityAt: Date; id: string };
function validCursor(value?: string): Cursor | null {
  if (!value || value.length > 170) return null;
  try {
    const [dateString, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const date = new Date(dateString);
    if (!dateString || !id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      Number.isNaN(date.getTime())) return null;
    return { lastActivityAt: date, id };
  } catch { return null; }
}
export function inboxCursor(row: Cursor): string {
  return Buffer.from(row.lastActivityAt.toISOString() + "|" + row.id).toString("base64url");
}
function safeFilters(filters: Filters, actor: { id: string; role: string },
  cursor: Cursor | null): Prisma.CommunicationThreadWhereInput {
  const where: Prisma.CommunicationThreadWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.resolution) where.resolution = filters.resolution;
  if (actor.role === "STAFF" || filters.assignment === "mine") {
    where.assignedUserId = actor.id;
  } else if (filters.assignment === "unassigned") {
    where.assignedUserId = null;
  }
  if (cursor) {
    where.OR = [
      { lastActivityAt: { lt: cursor.lastActivityAt } },
      { lastActivityAt: cursor.lastActivityAt, id: { lt: cursor.id } },
    ];
  }
  return where;
}

/** Staff get only explicitly assigned threads; OWNER/ADMIN can triage all. */
export async function listSmsInbox(actorId: string, filters: Filters = {},
  token?: string) {
  if (token && !validCursor(token)) throw new Error("Invalid inbox cursor.");
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId);
    const rows = await tx.communicationThread.findMany({
      where: safeFilters(filters, actor, validCursor(token)),
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      take: 31,
      select: {
        id: true, status: true, resolution: true, assignedUserId: true,
        version: true, lastActivityAt: true,
        // Provider messages may carry private data; list only status and
        // unread markers. Decrypt only after thread-level authorization.
        messages: { where: { direction: "INBOUND" },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1,
          select: { occurredAt: true, id: true } },
        readMarkers: { where: { userId: actorId }, take: 1,
          select: { lastReadOccurredAt: true, lastReadMessageId: true } },
      },
    });
    const next = rows.length > 30 ? inboxCursor(rows[29]) : null;
    return {
      rows: rows.slice(0,30).map(({ messages, readMarkers, ...row }) => {
        const recent = messages[0];
        const marker = readMarkers[0];
        const unread = Boolean(recent && (!marker?.lastReadOccurredAt ||
          recent.occurredAt > marker.lastReadOccurredAt ||
          (recent.occurredAt.getTime() === marker.lastReadOccurredAt.getTime() &&
            recent.id > (marker.lastReadMessageId ?? ""))));
        return { ...row, unread };
      }),
      next,
    };
  });
}

async function authorizeThreadInTx(
  tx: Prisma.TransactionClient, actorId: string, threadId: string,
  exclusive = false,
) {
  const actor = await assertActiveTeamActor(tx, actorId);
  if (exclusive) await tx.$queryRaw`SELECT "id" FROM "CommunicationThread" WHERE "id" = ${threadId} FOR UPDATE`;
  const thread = await tx.communicationThread.findUnique({
    where: { id: threadId },
    select: { id: true, assignedUserId: true, status: true, resolution: true,
      version: true, customerId: true, leadId: true, lastActivityAt: true },
  });
  if (!thread || (actor.role === "STAFF" && thread.assignedUserId !== actor.id)) {
    throw new Error("Communication thread not found or access denied.");
  }
  return { actor, thread };
}

export async function getSmsInboxThread(actorId: string, threadId: string) {
  return prisma.$transaction(async (tx) => {
    const { thread } = await authorizeThreadInTx(tx, actorId, threadId);
    const messages = await tx.communicationMessage.findMany({
      where: { threadId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, direction: true, occurredAt: true,
        bodyEncrypted: true, redactedAt: true,
        delivery: { select: { state: true } } },
    });
    const marker = await tx.communicationReadMarker.findUnique({
      where: { threadId_userId: { threadId, userId: actorId } },
      select: { lastReadMessageId: true },
    });
    return {
      ...thread,
      // No cross-customer account links until deterministic identity exists.
      customerId: thread.resolution === "RESOLVED" ? thread.customerId : null,
      leadId: thread.resolution === "RESOLVED" ? thread.leadId : null,
      lastReadMessageId: marker?.lastReadMessageId ?? null,
      messages: messages.reverse().map(({ bodyEncrypted, redactedAt, ...row }) => {
        let text = "[Unavailable or redacted]";
        if (bodyEncrypted && !redactedAt) {
          try { text = decryptCommunicationContent(bodyEncrypted); }
          catch { /* key unavailable; never leak ciphertext */ }
        }
        return { ...row, text, redacted: Boolean(redactedAt) };
      }),
    };
  });
}

export async function markSmsInboxRead(actorId: string, threadId: string, messageId: string) {
  return prisma.$transaction(async (tx) => {
    await authorizeThreadInTx(tx, actorId, threadId, true);
    const message = await tx.communicationMessage.findFirst({
      where: { id: messageId, threadId },
      select: { id: true, occurredAt: true },
    });
    if (!message) throw new Error("This message is not in the selected thread.");
    const existing = await tx.communicationReadMarker.findUnique({
      where: { threadId_userId: { threadId, userId: actorId } },
      select: { lastReadOccurredAt: true, lastReadMessageId: true },
    });
    if (existing?.lastReadOccurredAt &&
      (existing.lastReadOccurredAt > message.occurredAt ||
        (existing.lastReadOccurredAt.getTime() === message.occurredAt.getTime() &&
          (existing.lastReadMessageId ?? "") >= message.id))) return false;
    await tx.communicationReadMarker.upsert({
      where: { threadId_userId: { threadId, userId: actorId } },
      create: { threadId, userId: actorId,
        lastReadOccurredAt: message.occurredAt, lastReadMessageId: message.id },
      update: { lastReadOccurredAt: message.occurredAt, lastReadMessageId: message.id },
    });
    return true;
  });
}

export async function updateSmsThreadStatus(
  actorId: string, threadId: string, expectedVersion: number,
  status: "OPEN" | "WAITING" | "CLOSED",
) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("Invalid expected version.");
  }
  return prisma.$transaction(async (tx) => {
    const { thread } = await authorizeThreadInTx(tx, actorId, threadId, true);
    if (thread.version !== expectedVersion) {
      throw new Error("Conversation changed. Refresh and try again.");
    }
    await tx.communicationThread.update({
      where: { id: threadId }, data: { status, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "SMS_THREAD_STATUS_CHANGED",
        entityType: "CommunicationThread", entityId: threadId,
        oldValue: { status: thread.status, version: expectedVersion },
        newValue: { status, version: expectedVersion + 1 } },
    });
    return { status, version: expectedVersion + 1 };
  });
}

export async function assignSmsThread(actorId: string, threadId: string,
  expectedVersion: number, targetUserId: string | null) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("Invalid expected version.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const { thread } = await authorizeThreadInTx(tx, actorId, threadId, true);
    if (thread.version !== expectedVersion) throw new Error("Conversation changed. Refresh and try again.");
    if (targetUserId) await assertActiveTeamActor(tx, targetUserId);
    const updated = await tx.communicationThread.update({
      where: { id: threadId },
      data: { assignedUserId: targetUserId, version: { increment: 1 } },
      select: { assignedUserId: true, version: true },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "SMS_THREAD_ASSIGNED",
        entityType: "CommunicationThread", entityId: threadId,
        oldValue: { assignedUserId: thread.assignedUserId, version: expectedVersion },
        newValue: { assignedUserId: targetUserId, version: updated.version } },
    });
    return updated;
  });
}
