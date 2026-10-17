import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { SITE_FIELDS, sanitizeSiteFields, siteDefaultTypedValues, siteDefaults, siteFieldByKey } from "./fields";
import { checkReferencedAssets, promoteReferencedAssets } from "./assets";
import { diffValues, pagesAffected, factsUsed, type PageEffect, type ReviewChange, type FactUse } from "./review";
import { decodeOrThrow, encodeContentValues, legacyTextToValues, valueToPlainText } from "./codec";
import { CONTENT_SCHEMA_VERSION_TYPED, SITE_TEMPLATE_VERSION, SiteContentError, type SiteValue } from "./types";

/**
 * Website text in linear revisions (docs/archive/designs-completed/BATCH-D.md D1). The public site reads exactly one PUBLISHED revision
 * (named by the single pointer row). A draft is never visible to the public. Publishing and restoring lock the
 * pointer row, so two owners acting at once cannot leave two published revisions.
 */

export const STALE_DRAFT_MESSAGE = "Someone else changed this draft. Reload to see their changes.";
export const STALE_LIVE_MESSAGE = "The live website changed after you started reviewing. Reload and review the changes again before publishing.";
const TEAM = ["OWNER", "ADMIN"] as const;

type StoredRevision = { fields: unknown; contentSchemaVersion: number };

/** Typed values of one stored revision. A value that cannot be read is an explicit error, never odd text on a page. */
function valuesOf(row: StoredRevision): Record<string, SiteValue> {
  return decodeOrThrow(row.contentSchemaVersion, row.fields).values;
}

/** The plain text a text-only reader sees. Pictures, links and lists have their own readers. */
function stringsOf(values: Record<string, SiteValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const text = valueToPlainText(value);
    if (text !== undefined) out[key] = text;
  }
  return out;
}

function withDefaults(values: Record<string, SiteValue>): Record<string, string> {
  return { ...siteDefaults(), ...stringsOf(values) };
}

/** The starting value of every text field, as typed values. */
export function siteDefaultValues(): Record<string, SiteValue> {
  const out: Record<string, SiteValue> = {};
  for (const field of SITE_FIELDS) if ((field.valueKind ?? "text") === "text") out[field.key] = { kind: "text", text: field.default };
  return { ...out, ...siteDefaultTypedValues() };
}

/** What the public site shows: today's text unless a published revision changes it. Read once per request. */
export const getPublishedContent = cache(async (): Promise<Record<string, string>> => {
  const pointer = await prisma.siteContentPointer.findUnique({ where: { id: "published" } });
  if (!pointer?.publishedRevisionId) return siteDefaults();
  const revision = await prisma.siteContentRevision.findFirst({
    where: { id: pointer.publishedRevisionId, status: "PUBLISHED" },
    select: { fields: true, contentSchemaVersion: true },
  });
  return withDefaults(revision ? valuesOf(revision) : {});
});

/** V-C1: what the public site shows as typed values (text, links, pictures, lists, promotions), starting values included. */
export const getPublishedValues = cache(async (): Promise<Record<string, SiteValue>> => {
  const pointer = await prisma.siteContentPointer.findUnique({ where: { id: "published" } });
  if (!pointer?.publishedRevisionId) return siteDefaultValues();
  const revision = await prisma.siteContentRevision.findFirst({
    where: { id: pointer.publishedRevisionId, status: "PUBLISHED" },
    select: { fields: true, contentSchemaVersion: true },
  });
  return { ...siteDefaultValues(), ...(revision ? valuesOf(revision) : {}) };
});

/** Preview of any revision (draft or old). The caller must already have checked the viewer is an owner or admin. */
export async function getRevisionContent(revisionId: string): Promise<Record<string, string>> {
  const revision = await prisma.siteContentRevision.findUnique({
    where: { id: revisionId },
    select: { fields: true, contentSchemaVersion: true },
  });
  if (!revision) return getPublishedContent();
  return withDefaults(valuesOf(revision));
}

/** V-C3: one specific revision as typed values (starting values filled in), for the owner's draft or old-version preview. */
export async function getRevisionValues(revisionId: string): Promise<Record<string, SiteValue>> {
  const revision = await prisma.siteContentRevision.findUnique({
    where: { id: revisionId },
    select: { fields: true, contentSchemaVersion: true },
  });
  if (!revision) return getPublishedValues();
  return { ...siteDefaultValues(), ...valuesOf(revision) };
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
    draft: draft ? { id: draft.id, version: draft.version, note: draft.note, stored: stringsOf(valuesOf(draft)) } : null,
    published: published
      ? { id: published.id, version: published.version, publishedAt: published.publishedAt, stored: stringsOf(valuesOf(published)) }
      : null,
  };
}

/** V-C1: the open draft and the live revision as typed values (for the editor that handles more than text). */
export async function getEditorValueState(): Promise<{
  draft: { id: string; version: number; note: string | null; values: Record<string, SiteValue> } | null;
  published: { id: string; version: number; publishedAt: Date | null; values: Record<string, SiteValue> } | null;
}> {
  const [draft, pointer] = await Promise.all([
    prisma.siteContentRevision.findFirst({ where: { status: "DRAFT" }, orderBy: { version: "desc" } }),
    prisma.siteContentPointer.findUnique({ where: { id: "published" } }),
  ]);
  const published = pointer?.publishedRevisionId
    ? await prisma.siteContentRevision.findUnique({ where: { id: pointer.publishedRevisionId } })
    : null;
  return {
    draft: draft ? { id: draft.id, version: draft.version, note: draft.note, values: valuesOf(draft) } : null,
    published: published ? { id: published.id, version: published.version, publishedAt: published.publishedAt, values: valuesOf(published) } : null,
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
  input: {
    draftId?: string;
    expectedVersion?: number;
    /** The text the editor has always sent. Empty text means "not set". Pictures, links and lists already in the draft are kept. */
    fields?: Record<string, string>;
    /** V-C1: typed values, for content other than plain text. Replaces the whole draft. */
    values?: Record<string, unknown>;
    note?: string;
  },
): Promise<{ draftId: string; version: number }> {
  if (input.values !== undefined && input.fields !== undefined) throw new Error("Those website changes could not be read.");
  let typed: Record<string, SiteValue> | null = null;
  let legacy: Record<string, SiteValue> | null = null;
  if (input.values !== undefined) {
    const encoded = encodeContentValues(input.values);
    if (!encoded.ok) throw new Error(encoded.message);
    typed = encoded.stored;
  } else {
    const cleaned = sanitizeSiteFields(input.fields ?? {});
    if (!cleaned.ok) throw new Error(cleaned.message);
    legacy = legacyTextToValues(cleaned.fields);
  }
  const note = input.note?.replace(/[<>]/g, "").trim().slice(0, 300) || null;

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    const publishedId = await lockPointer(tx);
    const open = await tx.siteContentRevision.findFirst({ where: { status: "DRAFT" }, orderBy: { version: "desc" } });
    if (open) {
      if (!input.draftId || input.draftId !== open.id || input.expectedVersion !== open.version) {
        throw new Error(STALE_DRAFT_MESSAGE);
      }
      await tx.siteContentRevision.delete({ where: { id: open.id } });
    } else if (input.draftId) {
      throw new Error(STALE_DRAFT_MESSAGE);
    }
    let stored: Record<string, SiteValue>;
    if (typed) stored = typed;
    else {
      // A text-only save must not lose pictures or links already in the draft (or live): keep every non-text value.
      const baseRow = open ?? (publishedId ? await tx.siteContentRevision.findUnique({ where: { id: publishedId } }) : null);
      const base = baseRow ? valuesOf(baseRow) : {};
      const kept = Object.fromEntries(Object.entries(base).filter(([, value]) => value.kind !== "text" && value.kind !== "hidden"));
      stored = { ...kept, ...legacy! };
    }
    const version = await nextVersion(tx);
    const created = await tx.siteContentRevision.create({
      data: {
        status: "DRAFT", version, fields: stored as object, note, createdByUserId: userId,
        contentSchemaVersion: CONTENT_SCHEMA_VERSION_TYPED, templateVersion: SITE_TEMPLATE_VERSION,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "site_content.draft_saved",
        entityType: "SiteContentRevision",
        entityId: created.id,
        newValue: { version, fieldCount: Object.keys(stored).length, contentSchemaVersion: CONTENT_SCHEMA_VERSION_TYPED },
      },
    });
    return { draftId: created.id, version };
  });
}

/** Make the draft the live website text. The previous live revision is kept in history. */
/**
 * Make the reviewed draft live. `expectedLiveRevisionId` is the live version the owner was looking at when they
 * reviewed (null = nothing published yet); when given, a publish is refused if the live version has moved since. A
 * second publish of the very draft that is already live (a double click) changes nothing and succeeds.
 */
export async function publishDraft(
  userId: string,
  draftId: string,
  expectedVersion: number,
  expectedLiveRevisionId?: string | null,
): Promise<{ revisionId: string; version: number; alreadyLive?: true }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    const previousId = await lockPointer(tx);
    const draft = await tx.siteContentRevision.findUnique({ where: { id: draftId } });
    if (draft && draft.status === "PUBLISHED" && previousId === draft.id && draft.version === expectedVersion) {
      return { revisionId: draft.id, version: draft.version, alreadyLive: true as const };
    }
    if (!draft || draft.status !== "DRAFT" || draft.version !== expectedVersion) {
      throw new Error(STALE_DRAFT_MESSAGE);
    }
    if (expectedLiveRevisionId !== undefined && (previousId ?? null) !== expectedLiveRevisionId) {
      throw new Error(STALE_LIVE_MESSAGE);
    }
    // Every picture the draft uses must exist and be usable; draft pictures become public in this same transaction.
    const decoded = decodeOrThrow(draft.contentSchemaVersion, draft.fields);
    if (Object.keys(decoded.retired).length) throw new SiteContentError("This draft contains something the website no longer has a place for. Save it again from the editor, then publish.");
    const promoted = await promoteReferencedAssets(tx, decoded.values);
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
        newValue: { version: draft.version, picturesMadePublic: promoted.length },
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
    await promoteReferencedAssets(tx, valuesOf(source));
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
        fields: valuesOf(source) as object,
        contentSchemaVersion: CONTENT_SCHEMA_VERSION_TYPED,
        templateVersion: SITE_TEMPLATE_VERSION,
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

/** V-C4: put an older published version into the draft for review. It is NOT made live. */
export async function restoreRevisionToDraft(
  userId: string,
  revisionId: string,
  expected: { draftId?: string; draftVersion?: number } = {},
): Promise<{ draftId: string; version: number; replacedDraft: boolean }> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    await lockPointer(tx);
    const source = await tx.siteContentRevision.findUnique({ where: { id: revisionId } });
    if (!source || !source.publishedAt) throw new Error("That version was never published, so it cannot be restored.");
    const values = valuesOf(source);
    await checkReferencedAssets(tx, values); // a version that needs a removed picture is blocked with a plain message
    const open = await tx.siteContentRevision.findFirst({ where: { status: "DRAFT" }, orderBy: { version: "desc" } });
    if (open) {
      if (!expected.draftId || expected.draftId !== open.id || expected.draftVersion !== open.version) throw new Error(STALE_DRAFT_MESSAGE);
      await tx.siteContentRevision.delete({ where: { id: open.id } });
    } else if (expected.draftId) {
      throw new Error(STALE_DRAFT_MESSAGE);
    }
    const version = await nextVersion(tx);
    const created = await tx.siteContentRevision.create({
      data: {
        status: "DRAFT", version, fields: values as object, contentSchemaVersion: CONTENT_SCHEMA_VERSION_TYPED, templateVersion: SITE_TEMPLATE_VERSION,
        note: `Restored from version ${source.version} (not yet published)`, createdByUserId: userId, restoredFromId: source.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId, action: "site_content.restored_to_draft", entityType: "SiteContentRevision", entityId: created.id,
        oldValue: { replacedDraftId: open?.id ?? null },
        newValue: { version, restoredFromId: source.id, restoredFromVersion: source.version },
      },
    });
    return { draftId: created.id, version, replacedDraft: !!open };
  });
}

/** V-C4: throw the open draft away. The live website is untouched. */
export async function discardDraft(userId: string, draftId: string, expectedVersion: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    await lockPointer(tx);
    const draft = await tx.siteContentRevision.findUnique({ where: { id: draftId } });
    if (!draft || draft.status !== "DRAFT" || draft.version !== expectedVersion) throw new Error(STALE_DRAFT_MESSAGE);
    await tx.siteContentRevision.delete({ where: { id: draft.id } });
    await tx.auditLog.create({
      data: { userId, action: "site_content.draft_discarded", entityType: "SiteContentRevision", entityId: draft.id, oldValue: { version: draft.version }, newValue: {} },
    });
  });
}

export type WebsiteOverview = {
  live: { id: string; version: number; publishedAt: Date | null; publishedBy: string | null } | null;
  draft: { id: string; version: number; savedAt: Date; note: string | null; changeCount: number } | null;
  versionsPublished: number;
};

/** V-C4: the overview the Website screen opens on. */
export async function getWebsiteOverview(): Promise<WebsiteOverview> {
  const state = await getEditorValueState();
  const [history, count] = await Promise.all([
    state.published ? prisma.siteContentRevision.findUnique({ where: { id: state.published.id }, select: { publishedByUserId: true } }) : null,
    prisma.siteContentRevision.count({ where: { publishedAt: { not: null } } }),
  ]);
  const publisher = history?.publishedByUserId
    ? await prisma.user.findUnique({ where: { id: history.publishedByUserId }, select: { name: true, email: true } })
    : null;
  let draft: WebsiteOverview["draft"] = null;
  if (state.draft) {
    const row = await prisma.siteContentRevision.findUnique({ where: { id: state.draft.id }, select: { updatedAt: true } });
    const live = { ...siteDefaultValues(), ...(state.published?.values ?? {}) };
    const proposed = { ...siteDefaultValues(), ...state.draft.values };
    draft = { id: state.draft.id, version: state.draft.version, savedAt: row?.updatedAt ?? new Date(), note: state.draft.note, changeCount: diffValues(live, proposed).length };
  }
  return {
    live: state.published ? { id: state.published.id, version: state.published.version, publishedAt: state.published.publishedAt, publishedBy: publisher ? publisher.name || publisher.email : null } : null,
    draft,
    versionsPublished: count,
  };
}

export type DraftReview = {
  draft: { id: string; version: number } | null;
  liveRevisionId: string | null;
  changes: ReviewChange[];
  pages: PageEffect[];
  facts: FactUse[];
  /** Plain sentences naming what stops this draft from being published. Empty means it can be. */
  problems: string[];
};

/**
 * V-C4: exactly what publishing the open draft would change, against what is live right now. `currentFacts` are the
 * values the facts in the changed words have today in their owners (Settings).
 */
export async function getDraftReview(currentFacts: Parameters<typeof factsUsed>[1]): Promise<DraftReview> {
  const state = await getEditorValueState();
  if (!state.draft) return { draft: null, liveRevisionId: state.published?.id ?? null, changes: [], pages: [], facts: [], problems: [] };
  const live = { ...siteDefaultValues(), ...(state.published?.values ?? {}) };
  const proposed = { ...siteDefaultValues(), ...state.draft.values };
  const changes = diffValues(live, proposed);
  const problems: string[] = [];
  try {
    await checkReferencedAssets(prisma, state.draft.values);
  } catch (error) {
    if (error instanceof SiteContentError) problems.push(error.message);
    else throw error;
  }
  return {
    draft: { id: state.draft.id, version: state.draft.version },
    liveRevisionId: state.published?.id ?? null,
    changes,
    pages: pagesAffected(changes),
    facts: factsUsed(changes, currentFacts),
    problems,
  };
}

/** W-26 prepares reviewed owner fields; Batch V owns public Spanish routes. */
export async function getReviewedSiteContent(language: "en" | "es"): Promise<{language:"en"|"es";fields:Record<string,string>}> {
  const fields = await getPublishedContent();
  if (language === "en") return {language,fields};
  const { approvedSpanishSources, translationFromSnapshot } = await import("@/domains/language/runtime");
  const sources = await approvedSpanishSources();
  const translated = {...fields};
  try {
    for (const [key,english] of Object.entries(fields)) {
      if (siteFieldByKey(key)?.kind !== "url" && english.trim())
        translated[key] = translationFromSnapshot(sources,"SITE",key,english);
    }
    return {language:"es",fields:translated};
  } catch { return {language:"en",fields}; }
}
