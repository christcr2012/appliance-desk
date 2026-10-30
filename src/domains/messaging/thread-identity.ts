import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

// AR-4d (QUOTES-MESSAGES spec section 3): link a conversation's number to a
// person — the explicit staff review the inbound resolver has always
// required for unknown and shared numbers. Consent records are NOT touched:
// consent belongs to the contact point and stays exactly as recorded.

export type IdentityTarget = { customerId: string } | { leadId: string };

type PersonRef = { kind: "customer" | "lead"; id: string };

function targetRef(target: IdentityTarget): PersonRef {
  return "customerId" in target
    ? { kind: "customer", id: target.customerId }
    : { kind: "lead", id: target.leadId };
}

function bindingPerson(b: {
  customerId: string | null;
  leadId: string | null;
  customerContact: { customerId: string } | null;
}): PersonRef | null {
  if (b.customerId) return { kind: "customer", id: b.customerId };
  if (b.customerContact) return { kind: "customer", id: b.customerContact.customerId };
  if (b.leadId) return { kind: "lead", id: b.leadId };
  return null;
}

const samePerson = (a: PersonRef | null, b: PersonRef | null) =>
  a !== null && b !== null && a.kind === b.kind && a.id === b.id;

async function lockThread(tx: Prisma.TransactionClient, threadId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CommunicationThread" WHERE "id" = ${threadId} FOR UPDATE`;
  const thread = await tx.communicationThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      externalContactPointId: true,
      customerId: true,
      leadId: true,
      resolution: true,
      version: true,
    },
  });
  if (!thread) throw new Error("Conversation not found.");
  return thread;
}

export async function linkThreadIdentity(
  actorId: string,
  threadId: string,
  target: IdentityTarget,
  expectedVersion?: number,
) {
  const person = targetRef(target);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const thread = await lockThread(tx, threadId);
    if (expectedVersion !== undefined && thread.version !== expectedVersion) {
      throw new Error("Conversation changed. Refresh and try again.");
    }
    if (person.kind === "customer") {
      const customer = await tx.customer.findFirst({
        where: { id: person.id, archivedAt: null },
        select: { id: true },
      });
      if (!customer) throw new Error("That customer isn't available to link.");
    } else {
      const lead = await tx.lead.findFirst({
        where: { id: person.id, mergedIntoLeadId: null },
        select: { id: true },
      });
      if (!lead) throw new Error("That lead isn't available to link.");
    }

    const now = new Date();
    const bindings = await tx.contactBinding.findMany({
      where: { contactPointId: thread.externalContactPointId, revokedAt: null },
      select: {
        id: true,
        customerId: true,
        leadId: true,
        verifiedAt: true,
        customerContact: { select: { customerId: true } },
      },
    });
    const revokedIds: string[] = [];
    let keptId: string | null = null;
    for (const b of bindings) {
      if (samePerson(bindingPerson(b), person)) {
        if (!keptId) keptId = b.id;
        else revokedIds.push(b.id); // a duplicate binding for the same person
      } else {
        revokedIds.push(b.id);
      }
    }
    if (revokedIds.length) {
      await tx.contactBinding.updateMany({
        where: { id: { in: revokedIds } },
        data: { revokedAt: now },
      });
    }
    if (keptId) {
      await tx.contactBinding.update({
        where: { id: keptId },
        data: { verifiedAt: now },
      });
    } else {
      await tx.contactBinding.create({
        data: {
          contactPointId: thread.externalContactPointId,
          customerId: person.kind === "customer" ? person.id : null,
          leadId: person.kind === "lead" ? person.id : null,
          source: "STAFF",
          verifiedAt: now,
        },
      });
    }
    const updated = await tx.communicationThread.update({
      where: { id: threadId },
      data: {
        resolution: "RESOLVED",
        customerId: person.kind === "customer" ? person.id : null,
        leadId: person.kind === "lead" ? person.id : null,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "communication.identity_linked",
        entityType: "CommunicationThread",
        entityId: threadId,
        oldValue: {
          customerId: thread.customerId,
          leadId: thread.leadId,
          resolution: thread.resolution,
        },
        newValue: {
          customerId: person.kind === "customer" ? person.id : null,
          leadId: person.kind === "lead" ? person.id : null,
          resolution: "RESOLVED",
          revokedBindingIds: revokedIds,
        },
      },
    });
    return { version: updated.version };
  });
}

export async function unlinkThreadIdentity(actorId: string, threadId: string) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const thread = await lockThread(tx, threadId);
    const current: PersonRef | null = thread.customerId
      ? { kind: "customer", id: thread.customerId }
      : thread.leadId
        ? { kind: "lead", id: thread.leadId }
        : null;
    const now = new Date();
    let revokedBindingIds: string[] = [];
    if (current) {
      const bindings = await tx.contactBinding.findMany({
        where: { contactPointId: thread.externalContactPointId, revokedAt: null },
        select: {
          id: true,
          customerId: true,
          leadId: true,
          customerContact: { select: { customerId: true } },
        },
      });
      revokedBindingIds = bindings
        .filter((b) => samePerson(bindingPerson(b), current))
        .map((b) => b.id);
      if (revokedBindingIds.length) {
        await tx.contactBinding.updateMany({
          where: { id: { in: revokedBindingIds } },
          data: { revokedAt: now },
        });
      }
    }
    const updated = await tx.communicationThread.update({
      where: { id: threadId },
      data: {
        resolution: "UNRESOLVED",
        customerId: null,
        leadId: null,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "communication.identity_unlinked",
        entityType: "CommunicationThread",
        entityId: threadId,
        oldValue: {
          customerId: thread.customerId,
          leadId: thread.leadId,
          resolution: thread.resolution,
        },
        newValue: {
          customerId: null,
          leadId: null,
          resolution: "UNRESOLVED",
          revokedBindingIds,
        },
      },
    });
    return { version: updated.version };
  });
}

/** The other people this thread's number currently matches — shown in the
 * link confirmation so staff know whose match a link will end. */
export async function listThreadOtherMatches(actorId: string, threadId: string) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const thread = await tx.communicationThread.findUnique({
      where: { id: threadId },
      select: { externalContactPointId: true, customerId: true, leadId: true },
    });
    if (!thread) throw new Error("Conversation not found.");
    const current: PersonRef | null = thread.customerId
      ? { kind: "customer", id: thread.customerId }
      : thread.leadId
        ? { kind: "lead", id: thread.leadId }
        : null;
    const bindings = await tx.contactBinding.findMany({
      where: { contactPointId: thread.externalContactPointId, revokedAt: null },
      select: {
        id: true,
        customerId: true,
        leadId: true,
        customerContact: { select: { customerId: true } },
      },
    });
    const people = new Map<string, PersonRef>();
    for (const b of bindings) {
      const p = bindingPerson(b);
      if (p && !samePerson(p, current)) people.set(`${p.kind}:${p.id}`, p);
    }
    const out: Array<{ kind: "customer" | "lead"; id: string; name: string }> = [];
    for (const p of people.values()) {
      if (p.kind === "customer") {
        const c = await tx.customer.findUnique({
          where: { id: p.id },
          select: { companyName: true, user: { select: { name: true } } },
        });
        out.push({ kind: p.kind, id: p.id, name: c?.user.name ?? c?.companyName ?? "A customer" });
      } else {
        const l = await tx.lead.findUnique({
          where: { id: p.id },
          select: { contactName: true },
        });
        out.push({ kind: p.kind, id: p.id, name: l?.contactName ?? "A lead" });
      }
    }
    return out;
  });
}
