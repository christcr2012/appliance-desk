import "server-only";
import { translationDraftLimit } from "./draft-limits";
import { assertActiveTeamActor } from "@/lib/team-actor";

import { currentNoticeSources } from "./notice-language";
import { NOTICE_COPY, type NoticeCopyKey } from "./notice-copy";
import { legalTranslationSources } from "./legal";
import { TRANSACTIONAL_COPY } from "./transactional-copy";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getPublishedContent } from "@/domains/site-content";
import { siteFieldByKey } from "@/domains/site-content/fields";

export type TranslationSourceKind = "SITE" | "COMMUNICATION" | "MESSAGE" | "LEGAL" | "NOTICE";
export type TranslationSource = {
  kind: TranslationSourceKind;
  key: string;
  english: string;
  digest: string;
  spanish: string | null;
  revision: number | null;
  stale: boolean;
};

function digest(english: string) {
  return createHash("sha256").update(english).digest("hex");
}
function assertSourceKey(key: string) {
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(key)) throw new Error("Invalid translation source.");
}

export async function currentTranslationSource(
  kind: TranslationSourceKind, key: string,
): Promise<{ english: string; digest: string }> {
  assertSourceKey(key);
  let english: string | null = null;
  if (kind === "SITE") {
    const field = siteFieldByKey(key);
    if (!field || field.kind === "url") throw new Error("Not an editable text source.");
    english = (await getPublishedContent())[key] ?? field.default;
  } else if (kind === "COMMUNICATION") {
    const cut = key.lastIndexOf(":");
    const revisionId = key.slice(0, cut);
    const part = key.slice(cut + 1);
    if (cut < 1 || (part !== "subject" && part !== "body"))
      throw new Error("Choose the current template subject or body.");
    const row = await prisma.communicationTemplateRevision.findUnique({
      where: { id: revisionId },
      select: { subject: true, body: true, isCurrent: true },
    });
    if (!row?.isCurrent) throw new Error("The communication template is no longer current.");
    english = row[part];
  } else if (kind === "NOTICE") {
    const templates = await currentNoticeSources();
    english = Object.hasOwn(templates,key) ? templates[key as NoticeCopyKey] : null;
  } else if (kind === "LEGAL") {
    english = (await legalTranslationSources()).get(key) ?? null;
  } else if (kind === "MESSAGE") {
    english = Object.hasOwn(TRANSACTIONAL_COPY.en, key) ? TRANSACTIONAL_COPY.en[key as keyof typeof TRANSACTIONAL_COPY.en] : null;
  } else {
    throw new Error("Unsupported translation source.");
  }
  if (!english?.trim()) throw new Error("Empty English source cannot be translated.");
  return { english, digest: digest(english) };
}

/** One guarded edit against the exact English text the editor reviewed. */
export async function saveTranslationDraft(
  actorUserId: string,
  kind: TranslationSourceKind,
  key: string,
  expectedEnglishDigest: string,
  expectedRevision: number | null,
  spanishText: string,
): Promise<number> {
  const value = spanishText.trim();
  const limit=translationDraftLimit(kind);
  if (!value || value.length > limit || /[\u0000-\u0008\u000b-\u001f]/.test(value)) {
    throw new Error(`Spanish copy must be between 1 and ${limit.toLocaleString("en-US")} printable characters.`);
  }
  if (!/^[0-9a-f]{64}$/.test(expectedEnglishDigest) ||
      (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))) {
    throw new Error("Invalid translation revision.");
  }

  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"customer-spanish-review"}, 0))`;
    const current = await currentTranslationSource(kind, key);
    // The renderer substitutes exactly these source variables. A translation
    // must retain each placeholder once; otherwise customer-specific data may
    // disappear, or invented placeholders could leak unresolved template syntax.
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g)]
        .map(match => match[1]).sort();
    if (JSON.stringify(placeholders(current.english)) !== JSON.stringify(placeholders(value)))
      throw new Error("Spanish text must preserve all English template variables exactly.");

    if (current.digest !== expectedEnglishDigest)
      throw new Error("The English wording changed. Reload before editing the translation.");

    const existing = await tx.customerTranslationDraft.findUnique({
      where: { sourceKind_sourceKey: { sourceKind: kind, sourceKey: key } },
    });
    if ((existing?.revision ?? null) !== expectedRevision)
      throw new Error("Another editor updated this translation. Reload first.");
    let revision: number;
    if (existing) {
      const result = await tx.customerTranslationDraft.updateMany({
        where: { id: existing.id, revision: expectedRevision! },
        data: { spanishText: value, englishDigest: expectedEnglishDigest,
          editedByUserId: actorUserId, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new Error("Translation update collided; reload first.");
      revision = existing.revision + 1;
    } else {
      await tx.customerTranslationDraft.create({
        data: { sourceKind: kind, sourceKey: key, englishDigest: expectedEnglishDigest,
          spanishText: value, editedByUserId: actorUserId },
      });
      revision = 1;
    }
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "customer.translation.draft",
        entityType: "CustomerTranslationDraft", entityId: kind + ":" + key,
        newValue: { sourceKind: kind, sourceKey: key, revision, englishDigest: expectedEnglishDigest },
      },
    });
    return revision;
  });
}

export async function listCurrentTranslationDrafts(): Promise<TranslationSource[]> {
  const { SITE_FIELDS } = await import("@/domains/site-content/fields");
  const [site, templates, drafts, legal, notices] = await Promise.all([
    getPublishedContent(),
    prisma.communicationTemplateRevision.findMany({
      where: { isCurrent: true },
      orderBy: [{ channel: "asc" }, { key: "asc" }],
      select: { id: true, key: true, subject: true, body: true },
    }),
    prisma.customerTranslationDraft.findMany(),
    legalTranslationSources(),
    currentNoticeSources(),
  ]);
  const map = new Map(drafts.map(x => [x.sourceKind + ":" + x.sourceKey, x]));
  const sources: Array<{ kind: TranslationSourceKind; key: string; english: string }> = [
    ...SITE_FIELDS.filter(x => x.kind !== "url" && Boolean((site[x.key] ?? x.default).trim()))
      .map(x => ({ kind: "SITE" as const, key: x.key, english: site[x.key] ?? x.default })),
    ...Object.entries(notices).map(([key,english])=>({kind:"NOTICE" as const,key,english})),
    ...[...legal.entries()].map(([key,english]) => ({kind:"LEGAL" as const,key,english})),
    ...Object.entries(TRANSACTIONAL_COPY.en).map(([key,english]) => ({kind:"MESSAGE" as const,key,english})),
    ...templates.flatMap(x => [
      ...(x.subject ? [{kind: "COMMUNICATION" as const, key: x.id + ":subject", english: x.subject}] : []),
      {kind: "COMMUNICATION" as const, key: x.id + ":body", english: x.body},
    ]),
  ];
  return sources.map(source => {
    const row = map.get(source.kind + ":" + source.key);
    const hash = digest(source.english);
    return { ...source, digest: hash,
      spanish: row?.spanishText ?? (source.kind === "MESSAGE" ? TRANSACTIONAL_COPY.es[source.key as keyof typeof TRANSACTIONAL_COPY.es] : source.kind === "NOTICE" && source.english === NOTICE_COPY.en[source.key as NoticeCopyKey] ? NOTICE_COPY.es[source.key as NoticeCopyKey] : null),
      revision: row?.revision ?? null,
      stale: Boolean(row && row.englishDigest !== hash) };
  });
}
