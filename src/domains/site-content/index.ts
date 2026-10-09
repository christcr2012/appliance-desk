import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { sanitizeSiteFields, siteDefaults, siteFieldByKey } from "./fields";

/**
 * Website text in linear revisions (docs/archive/designs-completed/BATCH-D.md D1). The public site reads exactly one PUBLISHED revision
 * (named by the single pointer row). A draft is never visible to the public. Publishing and restoring lock the
 * pointer row, so two owners acting at once cannot leave two published revisions.
 */

export const STALE_DRAFT_MESSAGE = "Someone else changed this draft. Reload to see their changes.";
const TEAM = ["OWNER", "ADMIN"] as const;

/** Keep only whitelisted string values from stored JSON, so a bad row can never show unknown text. */
function cleanStored(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (siteFieldByKey(key) && typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

function withDefaults(stored: Record<string, string>): Record<string, string> {
  return { ...siteDefaults(), ...stored };
}

/** What the public site shows: today's text unless a published revision changes it. Read once per request. */
export const getPublishedContent = cache(async (): Promise<Record<string, string>> => {
  const pointer = await prisma.siteContentPointer.findUnique({ where: { id: "published" } });
  if (!pointer?.publishedRevisionId) return siteDefaults();
  const revision = await prisma.siteContentRevision.findFirst({
    where: { id: pointer.publishedRevisionId, status: "PUBLISHED" },
    select: { fields: true },
  });
  return withDefaults(cleanStored(revision?.fields));
});

/** Preview of any revision (draft or old). The caller must already have checked the viewer is an owner or admin. */
export async function getRevisionContent(revisionId: string): Promise<Record<string, string>> {
  const revision = await prisma.siteContentRevision.findUnique({
    where: { id: revisionId },
    select: { fields: true },
  });
  if (!revision) return getPublishedContent();
  return withDefaults(cleanStored(revision.fields));
}

/** The values the editor form starts from: the open draft if there is one, otherwise what is live. */
export async function getEditorState(): Promise<{
  draft: { id: string; version: number; note: string | null; stored: Record<string, string> } | null;
  published: { id: string; version: number; publishedAt: Date | null; stored: Record<string, string> } | null;
}> {
  const [draft, pointer] = await Promise.all([
    prisma.siteContentRevision.findFirst({ where: { status: "DRAFT" }, orderBy: { version: "desc" } }),
    prisma.siteContentPointer.findUnique({ where: { id: "published" } }),
  ]);
  const published = pointer?.publishedRevisionId
    ? await prisma.siteContentRevision.findUnique({ where: { id: pointer.publishedRevisionId } })
    : null;
  return {
    draft: draft ? { id: draft.id, version: draft.version, note: draft.note, stored: cleanStored(draft.fields) } : null,
    published: published
      ? { id: published.id, version: published.version, publishedAt: published.publishedAt, stored: cleanStored(published.fields) }
      : null,
  };
}

/** Everything that was ever live, newest first, with who and when. */
export async function listPublishedHistory(take = 50) {
  const rows = await prisma.siteContentRevision.findMany({
    where: { publishedAt: { not: null } },
    orderBy: { version: "desc" },
    take,
    select: { id: true, version: true, status: true, note: true, publishedAt: true, publishedByUserId: true, restoredFromId: true },
  });
  const ids = [...new Set(rows.map((r) => r.publishedByUserId).filter((v): v is string => !!v))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => ({ ...r, publishedBy: r.publishedByUserId ? (names.get(r.publishedByUserId) ?? null) : null }));
}

/** Take the one lock every change to the revision list goes through. */
async function lockPointer(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`
    INSERT INTO "SiteContentPointer" ("id", "updatedAt") VALUES ('published', now()) ON CONFLICT ("id") DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ publishedRevisionId: string | null }[]>`
    SELECT "publishedRevisionId" FROM "SiteContentPointer" WHERE "id" = 'published' FOR UPDATE
  `;
  return rows[0]?.publishedRevisionId ?? null;
}

async function nextVersion(tx: Prisma.TransactionClient): Promise<number> {
  const top = await tx.siteContentRevision.aggregate({ _max: { version: true } });
  return (top._max.version ?? 0) + 1;
}

/**
 * Save the owner's draft. A save replaces the open draft with a new one (one open draft at a time), so a second
 * person saving from an older screen is refused instead of overwriting. `expectedVersion` is the draft version the
 * screen was opened on (omit it only when there was no draft).
 */
export async function saveDraft(
  userId: string,
  input: { draftId?: string; expectedVersion?: number; fields: Record<string, string>; note?: string },
): Promise<{ draftId: string; version: number }> {
  const cleaned = sanitizeSiteFields(input.fields);
  if (!cleaned.ok) throw new Error(cleaned.message);
  const note = input.note?.replace(/[<>]/g, "").trim().slice(0, 300) || null;

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    await lockPointer(tx);
    const open = await tx.siteContentRevision.findFirst({ where: { status: "DRAFT" }, orderBy: { version: "desc" } });
    if (open) {
      if (!input.draftId || input.draftId !== open.id || input.expectedVersion !== open.version) {
        throw new Error(STALE_DRAFT_MESSAGE);
      }
      await tx.siteContentRevision.delete({ where: { id: open.id } });
    } else if (input.draftId) {
      throw new Error(STALE_DRAFT_MESSAGE);
    }
    const version = await nextVersion(tx);
    const created = await tx.siteContentRevision.create({
      data: { status: "DRAFT", version, fields: cleaned.fields, note, createdByUserId: userId },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "site_content.draft_saved",
        entityType: "SiteContentRevision",
        entityId: created.id,
        newValue: { version, fieldCount: Object.keys(cleaned.fields).length },
      },
    });
    return { draftId: created.id, version };
  });
}

/** Make the draft the live website text. The previous live revision is kept in history. */
export async function publishDraft(
  userId: string,
  draftId: string,
  expectedVersion: number,
): Promise<{ revisionId: string; version: number }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    const previousId = await lockPointer(tx);
    const draft = await tx.siteContentRevision.findUnique({ where: { id: draftId } });
    if (!draft || draft.status !== "DRAFT" || draft.version !== expectedVersion) {
      throw new Error(STALE_DRAFT_MESSAGE);
    }
    if (previousId) {
      await tx.siteContentRevision.updateMany({
        where: { id: previousId, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
    }
    const now = new Date();
    await tx.siteContentRevision.update({
      where: { id: draft.id },
      data: { status: "PUBLISHED", publishedAt: now, publishedByUserId: userId },
    });
    await tx.siteContentPointer.update({ where: { id: "published" }, data: { publishedRevisionId: draft.id } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "site_content.published",
        entityType: "SiteContentRevision",
        entityId: draft.id,
        oldValue: { previousRevisionId: previousId },
        newValue: { version: draft.version },
      },
    });
    return { revisionId: draft.id, version: draft.version };
  });
}

/** Put an older version live again. This publishes a NEW revision holding the old text; history is never edited. */
export async function restoreRevision(userId: string, revisionId: string): Promise<{ newRevisionId: string }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    const previousId = await lockPointer(tx);
    const source = await tx.siteContentRevision.findUnique({ where: { id: revisionId } });
    if (!source || !source.publishedAt) throw new Error("That version was never published, so it cannot be restored.");
    if (previousId) {
      await tx.siteContentRevision.updateMany({
        where: { id: previousId, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
    }
    const version = await nextVersion(tx);
    const created = await tx.siteContentRevision.create({
      data: {
        status: "PUBLISHED",
        version,
        fields: cleanStored(source.fields),
        note: `Restored version ${source.version}`,
        createdByUserId: userId,
        publishedAt: new Date(),
        publishedByUserId: userId,
        restoredFromId: source.id,
      },
    });
    await tx.siteContentPointer.update({ where: { id: "published" }, data: { publishedRevisionId: created.id } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "site_content.restored",
        entityType: "SiteContentRevision",
        entityId: created.id,
        oldValue: { previousRevisionId: previousId },
        newValue: { version, restoredFromId: source.id, restoredFromVersion: source.version },
      },
    });
    return { newRevisionId: created.id };
  });
}
