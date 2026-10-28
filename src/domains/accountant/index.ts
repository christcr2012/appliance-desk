import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { forgetTrustedDevicesInTx } from "@/domains/security/trusted-devices";
import { formatMoney } from "@/lib/money-ui";

// ACCT-1: what the owner sees about the accountant (the changes feed + the seen marker) and the nightly
// access-expiry sweep. The accountant's changes themselves are written by the books / compliance /
// decisions / records domains and audited under the accountant's own user id — this module only reads
// those audit rows back in plain words.

export type AccountantChange = {
  id: string;
  at: Date;
  actorName: string;
  actorFirm: string | null;
  summary: string;
  href: string | null;
};

async function accountantActors(tx: Prisma.TransactionClient) {
  return tx.user.findMany({
    where: { role: "ACCOUNTANT" },
    select: { id: true, name: true, email: true, firm: true },
  });
}

function actorLabel(actor: { name: string | null; email: string }): string {
  return actor.name || actor.email;
}

/** Plain words for one audit row (spec section 4's example: "Moved $120 from Supplies to Repairs — note: …"). */
async function summarize(row: {
  id: string; userId: string | null; action: string; entityType: string; entityId: string;
  newValue: unknown; createdAt: Date;
}): Promise<{ summary: string; href: string | null }> {
  const value = (row.newValue ?? {}) as Record<string, unknown>;
  switch (row.action) {
    case "books.adjustment.create": {
      const entry = await prisma.journalEntry.findUnique({
        where: { id: row.entityId },
        include: { lines: { include: { ledgerAccount: { select: { name: true } } } } },
      });
      const note = typeof value.memo === "string" ? value.memo : entry?.memo ?? "";
      const total = typeof value.totalCents === "number" ? value.totalCents : 0;
      const debits = entry?.lines.filter((l) => l.debitCents > 0) ?? [];
      const credits = entry?.lines.filter((l) => l.creditCents > 0) ?? [];
      const head = entry && debits.length === 1 && credits.length === 1
        ? `Moved ${formatMoney(total)} from ${credits[0]!.ledgerAccount.name} to ${debits[0]!.ledgerAccount.name}`
        : `Posted an adjusting entry of ${formatMoney(total)}`;
      return {
        summary: `${head}${note ? ` — note: “${note}”` : ""}`,
        href: entry ? `/desk/books/months/${entry.periodKey}` : "/desk/books",
      };
    }
    case "books.adjustment.reverse":
      return { summary: "Reversed an adjusting entry", href: "/desk/books" };
    case "books.mapping.update": {
      const account = await prisma.ledgerAccount.findUnique({ where: { id: row.entityId }, select: { name: true } });
      return { summary: `Changed the account mapping for ${account?.name ?? "an account"}`, href: "/desk/books" };
    }
    case "books.period.close":
    case "books.period.close-review":
      return { summary: `Closed the books for ${row.entityId}`, href: `/desk/books/months/${row.entityId}` };
    case "books.period.reopen":
      return { summary: `Reopened the books for ${row.entityId}`, href: `/desk/books/months/${row.entityId}` };
    case "books.asset.policy":
      return { summary: "Changed an appliance's book life or salvage value", href: "/desk/books/assets" };
    case "books.asset.tax-evidence":
      return { summary: "Added tax-basis evidence for an appliance (section 179 / bonus)", href: "/desk/books/assets" };
    case "books.bank.match.confirm":
      return { summary: "Matched a bank transaction to the books", href: "/desk/books/cash" };
    case "books.bank.match.void":
      return { summary: "Undid a bank match", href: "/desk/books/cash" };
    case "taxben.elections.save": {
      const classes = Array.isArray(value.bonusElectOutClasses)
        ? (value.bonusElectOutClasses as unknown[]).filter((c) => typeof c === "string")
        : [];
      return {
        summary: classes.length
          ? `Changed the bonus depreciation election for ${row.entityId} (electing out for ${classes.length} ${classes.length === 1 ? "class" : "classes"})`
          : `Cleared the bonus depreciation elect-out for ${row.entityId}`,
        href: `/desk/sales-tax/benefits?year=${row.entityId}`,
      };
    }
    case "compliance.prepare":
      return { summary: "Edited the prepared figures on a filing", href: `/desk/compliance/${row.entityId}` };
    case "compliance.review":
      return { summary: "Marked a filing reviewed", href: `/desk/compliance/${row.entityId}` };
    case "decision.professional_answer": {
      const subjectId = typeof value.subjectId === "string" ? value.subjectId : null;
      return { summary: `Answered a question for your CPA${subjectId ? ` (${subjectId})` : ""}`, href: "/desk/settings/decisions" };
    }
    case "records.file_added": {
      const record = await prisma.businessPaperwork.findUnique({ where: { id: row.entityId }, select: { title: true } });
      return { summary: `Added a document to the shared record “${record?.title ?? "a record"}”`, href: `/desk/paperwork/${row.entityId}` };
    }
    default:
      return { summary: `Made a change (${row.action})`, href: null };
  }
}

/** The owner's "Changes by your accountant" feed (Books home). Newest first. */
export async function listAccountantChanges(ownerId: string, limit = 30): Promise<AccountantChange[]> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER", "ADMIN"]);
    const actors = await accountantActors(tx);
    if (actors.length === 0) return [];
    const byId = new Map(actors.map((a) => [a.id, a]));
    const rows = await tx.auditLog.findMany({
      where: { userId: { in: actors.map((a) => a.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    const changes: AccountantChange[] = [];
    for (const row of rows) {
      const actor = row.userId ? byId.get(row.userId) : undefined;
      if (!actor) continue;
      const { summary, href } = await summarize({ ...row, entityId: row.entityId ?? "" });
      changes.push({
        id: row.id, at: row.createdAt, actorName: actorLabel(actor), actorFirm: actor.firm, summary, href,
      });
    }
    return changes;
  });
}

/** How many accountant changes the owner has not seen yet (drives the Today card). */
export async function unseenAccountantChangeCount(ownerId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER", "ADMIN"]);
    const actors = await accountantActors(tx);
    if (actors.length === 0) return 0;
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" }, select: { accountantChangesSeenAt: true },
    });
    const seenAt = settings?.accountantChangesSeenAt ?? null;
    return tx.auditLog.count({
      where: { userId: { in: actors.map((a) => a.id) }, ...(seenAt ? { createdAt: { gt: seenAt } } : {}) },
    });
  });
}

/** Stamp the owner's "last looked" marker (Books home does this when the owner opens it). */
export async function markAccountantChangesSeen(ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", accountantChangesSeenAt: new Date() },
      update: { accountantChangesSeenAt: new Date() },
    });
  });
}

/**
 * The nightly sweep: accountants whose end date has passed lose their sessions (sign-in itself is already
 * refused by session validation; this makes sure nothing lingers). Returns how many were swept.
 */
export async function revokeEndedAccountantSessions(now = new Date()): Promise<number> {
  const ended = await prisma.user.findMany({
    where: { role: "ACCOUNTANT", archivedAt: null, accessEndsOn: { not: null, lte: now } },
    select: { id: true },
  });
  let swept = 0;
  for (const user of ended) {
    const count = await prisma.$transaction(async (tx) => {
      const deleted = await tx.session.deleteMany({ where: { userId: user.id } });
      if (deleted.count === 0) return 0;
      await forgetTrustedDevicesInTx(tx, user.id);
      await tx.auditLog.create({
        data: {
          userId: null, action: "accountant.access_expired", entityType: "User", entityId: user.id,
          newValue: { sessionsRevoked: deleted.count },
        },
      });
      return 1;
    });
    swept += count;
  }
  return swept;
}
